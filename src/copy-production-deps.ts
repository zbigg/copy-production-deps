//
// copy-production-deps
//
//
// Prepare `node_modules` folder for `package` living in monorepo managed by `yarn workspaces`.
//
// Created because as for now, `yarn` can't create proper "focues" install with local package
// dependencies.

import path from "path";
import fs from "fs";
import semver from "semver";
import _ from "lodash";
import fsExtra from "fs-extra";
import debugFactory from "debug";
const debug = debugFactory("copy-production-deps");

const rootDir = path.dirname(process.cwd());

export function absolute(p: string) {
    return path.resolve(process.cwd(), p);
}

export function relative(p: string) {
    return p === "." ? p : path.relative(process.cwd(), p);
}

export interface Dependency {
    name: string;
    version: string;
}

export interface BadDependency {
    name: string;
    version: string;
    users: SourcePackage[];
}

export interface SourcePackage extends Dependency {
    level: number;
    sourceDir: string;
    deps: SourcePackage[];
    users: SourcePackage[];
}

export interface ResolvedPackage extends SourcePackage {
    targetDir: string;
    parent?: ResolvedPackage | undefined;
}

function isProperSourcePackage(pkg: SourcePackage | BadDependency): pkg is SourcePackage {
    return typeof (pkg as SourcePackage).sourceDir === "string";
}

function isBadDependency(pkg: SourcePackage | BadDependency): pkg is BadDependency {
    return typeof (pkg as SourcePackage).sourceDir === "undefined";
}

export type Context = Array<SourcePackage | BadDependency>;
/**
 * Check if `targetPackage` is resolvable from context of `user` package.
 */
function isResolvable(targetPackage: ResolvedPackage, user: ResolvedPackage): boolean {
    const targetPackageResolvableRootAbsolute = absolute(path.dirname(path.dirname(targetPackage.targetDir))) + "/";
    const userTargetAbsolute = absolute(user.targetDir) + "/";
    const result = userTargetAbsolute.startsWith(targetPackageResolvableRootAbsolute);
    // console.log(
    //     `${targetPackage.name}@${targetPackage.version} ${relative(
    //         targetPackageResolvableRootAbsolute
    //     )} x ${relative(userTargetAbsolute)} -> ${result}`
    // );
    return result;
}

function loadJsonSync(filePath: string) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Add `SourcePackage` to `context` preventing duplicates.
 *
 * Fills [[SourcePackage.users]] field.
 *
 * @param r
 * @param user
 * @param context
 */
function addPackage(
    r: Pick<SourcePackage, "name" | "version" | "sourceDir">,
    user: SourcePackage,
    context: Context
): SourcePackage {
    for (const existingEntry of context.filter(isProperSourcePackage)) {
        if (
            existingEntry.name === r.name &&
            existingEntry.version === r.version &&
            existingEntry.sourceDir === r.sourceDir
        ) {
            existingEntry.users.push(user);
            existingEntry.level = Math.min(user.level + 1, existingEntry.level);
            return existingEntry;
        }
    }
    const newEntry: SourcePackage = {
        ...r,
        level: user.level + 1,
        deps: [],
        users: [user]
    };
    context.push(newEntry);
    return newEntry;
}

/**
 * Looks for `dependencies` of `pkg` and fills `pkg.deps`, using `context`.
 *
 * Recursively processes found deps too.
 *
 * Fills `context` and respective `pkg.deps` thus creating linked tree of packages starting with
 * `pkg`.
 */
function lookForDependenciesInWorkspace(pkg: SourcePackage, dependencies: Dependency[], context: Context) {
    const subPackages: SourcePackage[] = [];
    for (const { name, version } of dependencies) {
        // Start from sourcePackageDir/node_modules and look for deps, they should be there or
        // in already found folders!
        // In general, assuming that yarn did it's job, they should be found either in
        //   - step1, i.e in sourcePackageDir/node_modules/name/node_modules
        //   - somewhere in parent
        let searchPackageDir = pkg.sourceDir;
        while (true) {
            let candidatePath = relative(path.join(searchPackageDir, "node_modules", name));
            const candidatePackageJsonPath = relative(path.join(candidatePath, "package.json"));
            if (fs.existsSync(candidatePackageJsonPath)) {
                const candidatePackageJson = loadJsonSync(absolute(candidatePackageJsonPath));
                const candidateVersion: string = candidatePackageJson.version;
                if (!semver.valid(version) || semver.satisfies(candidateVersion, version)) {
                    const newDep = addPackage(
                        {
                            name,
                            version: candidateVersion,
                            sourceDir: candidatePath
                        },
                        pkg,
                        context
                    );
                    subPackages.push(newDep);
                    pkg.deps.push(newDep);
                    break;
                }
            }
            const idx = searchPackageDir.lastIndexOf("/node_modules");
            if (idx !== -1) {
                searchPackageDir = searchPackageDir.substr(0, idx + 1);
                continue;
            } else if (searchPackageDir !== rootDir && searchPackageDir !== "/") {
                searchPackageDir = path.resolve(searchPackageDir, "..");
            } else {
                console.error(`error: cannot find ${name} required in ${pkg.sourceDir}`);
                context.push({
                    name,
                    version,
                    users: [pkg]
                });
                break;
            }
        }
    }

    for (const sp of subPackages) {
        processPackage(sp, context);
    }
}

export function processPackage(pkg: SourcePackage, context: Context) {
    const packageJsonPath = absolute(path.join(pkg.sourceDir, "package.json"));
    const packageJson = loadJsonSync(packageJsonPath);
    const localDependencies = Object.keys(packageJson.dependencies || {}).map(name => {
        return {
            name,
            version: packageJson.dependencies[name]
        };
    });

    lookForDependenciesInWorkspace(pkg, localDependencies, context);
}

// function mostUsedVersion(allVersionsOfPkg: DepResult[]): string | undefined {
//     const versionCounts = _.countBy(allVersionsOfPkg, "version");
//     const sortedVersions = _.sortBy(Object.keys(versionCounts), k => -versionCounts[k]);
//     const bestVersion =
//         sortedVersions.length > 1 &&
//         versionCounts[sortedVersions[0]] !== versionCounts[sortedVersions[1]]
//             ? sortedVersions[0]
//             : undefined;
//     console.log(
//         `${allVersionsOfPkg[0].name} best version ${bestVersion} - ${JSON.stringify(versionCounts)}`
//     );
//     return bestVersion;
// }

export function assignTargetDirs(allPackages: Context, rootPkg: ResolvedPackage): ResolvedPackage[] {
    const byName: Map<string, SourcePackage[]> = new Map();
    for (const dr of allPackages.filter(isProperSourcePackage)) {
        const packageResults = byName.get(dr.name);
        if (packageResults === undefined) {
            byName.set(dr.name, [dr]);
        } else {
            packageResults.push(dr);
        }
    }
    const depToResolved: Map<SourcePackage, ResolvedPackage> = new Map();
    const result: ResolvedPackage[] = [];

    const resolve = (pkg: SourcePackage, user: ResolvedPackage): ResolvedPackage => {
        const allVersionsOfMe = byName.get(pkg.name)!;
        const imTheOnlyOne = allVersionsOfMe.length === 1;
        const usedByRoot = pkg.users.includes(rootPkg);
        if (imTheOnlyOne || usedByRoot) {
            const targetDir = path.join(rootPkg.targetDir, "node_modules", pkg.name);
            return {
                ...pkg,
                targetDir
            };
        } else {
            // Search if there are other resolved ones with same version
            // up there in tree
            const resolvedVersions = allVersionsOfMe.map(p => p !== pkg && depToResolved.get(p));
            for (const otherResolved of resolvedVersions) {
                if (!otherResolved) {
                    continue;
                }
                if (otherResolved.version === pkg.version && isResolvable(otherResolved, user)) {
                    // console.log(
                    //     `${pkg.name}@${pkg.version} for ${relative(
                    //         user.targetDir
                    //     )} reuses ${relative(otherResolved.targetDir)}`
                    // );
                    return otherResolved;
                }
            }
            // not the only one and not used by root
            const targetDir = path.join(user.targetDir, "node_modules", pkg.name);
            // console.log(
            //     `${pkg.name}@${pkg.version} ${pkg.sourceDir} ${pkg.users
            //         .map(p => p.sourceDir)
            //         .join(" ")} ${allVersionsOfMe.map(p => p.version)} #WTF!`
            // );
            return {
                ...pkg,
                targetDir
            };
        }
    };
    const packagesToResolve: [SourcePackage, ResolvedPackage][] = rootPkg.deps.map(d => [d, rootPkg]);
    const allResolved: Set<ResolvedPackage> = new Set();
    const getResolved = (pkg: SourcePackage, user: ResolvedPackage): ResolvedPackage => {
        let r = depToResolved.get(pkg);
        if (r === undefined) {
            r = resolve(pkg, user);
            depToResolved.set(pkg, r);
            if (!allResolved.has(r)) {
                allResolved.add(r);
                r.parent = user;
                result.push(r);
                // console.log(`${pkg.name}@${pkg.version} ${pkg.sourceDir} -> ${r.targetDir}`);

                for (const dep of pkg.deps) {
                    packagesToResolve.push([dep, r]);
                }
            }
        }
        return r;
    };
    while (packagesToResolve.length > 0) {
        const [pkg, user] = packagesToResolve.shift()!;
        getResolved(pkg, user);
    }
    return result;
}

export interface CopyProductionDepsOptions {
    dryRun?: boolean;
    verbose?: boolean;
    excludePaths?: (srcFileName: string) => boolean;
}

export async function copyProductionDeps(
    sourceDir: string,
    targetDir: string,
    options: CopyProductionDepsOptions = {}
): Promise<ResolvedPackage[]> {
    const context: SourcePackage[] = [];
    const rootDep: ResolvedPackage = {
        sourceDir: sourceDir,
        name: "root",
        version: "n/a",
        users: [],
        deps: [],
        targetDir: targetDir,
        level: 0
    };
    if (options.verbose) {
        console.error(`copy-production-deps: collecting production packages for ${relative(sourceDir)}`);
    }
    processPackage(rootDep, context);
    const badPackages = context.filter(isBadDependency);
    if (badPackages.length > 0) {
        throw Object.assign(new Error("Some packages not found."), {
            badPackages
        });
    }
    if (options.verbose) {
        console.error(`copy-production-deps: found ${context.length} packages`);
    }
    const targetPackages = assignTargetDirs(context, rootDep);

    const targetNodeModules = path.join(targetDir, "node_modules");
    debug(`removing ${targetNodeModules}`);
    if (!options.dryRun) {
        fsExtra.removeSync(targetNodeModules);
        fsExtra.ensureDirSync(targetNodeModules);
    }

    for (const resolvedDependency of targetPackages) {
        const skipDep = options.excludePaths ? options.excludePaths(resolvedDependency.sourceDir) : false;
        debug("filter", resolvedDependency.sourceDir, !skipDep);
        if (skipDep) {
            continue;
        }
        debug(`copy ${resolvedDependency.sourceDir} -> ${resolvedDependency.targetDir}`);
        if (options.verbose) {
            console.error(`${relative(resolvedDependency.sourceDir)} -> ${relative(resolvedDependency.targetDir)}`);
        }
        if (!options.dryRun) {
            fsExtra.ensureDirSync(resolvedDependency.targetDir);
        }
        await fsExtra.copy(resolvedDependency.sourceDir + "/", resolvedDependency.targetDir + "/", {
            recursive: true,
            filter: (src: string, dest: string) => {
                const verdict = options.excludePaths ? !options.excludePaths(src) : true;
                debug("filter", src, verdict);
                return verdict && !options.dryRun;
            }
        });
    }
    return targetPackages;
}
