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

let errors = 0;

const rootDir = path.dirname(process.cwd());

function absolute(p: string) {
    return path.resolve(process.cwd(), p);
}
function relative(p: string) {
    return p === "." ? p : path.relative(process.cwd(), p);
}

interface Dependency {
    name: string;
    version: string;
}

interface SourcePackage extends Dependency {
    level: number;
    sourceDir: string;
    deps: SourcePackage[];
    users: SourcePackage[];
}

interface ResolvedPackage extends SourcePackage {
    targetDir: string;
    parent?: ResolvedPackage | undefined;
}

/**
 * Check if `targetPackage` is resolvable from context of `user` package.
 */
function isResolvable(targetPackage: ResolvedPackage, user: ResolvedPackage): boolean {
    const targetPackageResolvableRootAbsolute =
        absolute(path.dirname(path.dirname(targetPackage.targetDir))) + "/";
    const userTargetAbsolute = absolute(user.targetDir) + "/";
    const result = userTargetAbsolute.startsWith(targetPackageResolvableRootAbsolute);
    // console.log(
    //     `${targetPackage.name}@${targetPackage.version} ${relative(
    //         targetPackageResolvableRootAbsolute
    //     )} x ${relative(userTargetAbsolute)} -> ${result}`
    // );
    return result;
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
    context: SourcePackage[]
): SourcePackage {
    for (const existingEntry of context) {
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
    //console.log(`${r.name}@${r.version} will use ${r.sourceDir}`);
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
function lookForDependenciesInWorkspace(
    pkg: SourcePackage,
    dependencies: Dependency[],
    context: SourcePackage[]
) {
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
                const candidatePackageJson = require(absolute(candidatePackageJsonPath));
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
                errors++;
                break;
            }
        }
    }

    for (const sp of subPackages) {
        processPackage(sp, context);
    }
}

function processPackage(pkg: SourcePackage, context: SourcePackage[]) {
    const packageJsonPath = absolute(path.join(pkg.sourceDir, "package.json"));
    const packageJson = require(packageJsonPath);
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

function assignTargetDirs(
    allPackages: SourcePackage[],
    rootPkg: ResolvedPackage
): ResolvedPackage[] {
    const byName: Map<string, SourcePackage[]> = new Map();
    for (const dr of allPackages) {
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
    const packagesToResolve: [SourcePackage, ResolvedPackage][] = rootPkg.deps.map(d => [
        d,
        rootPkg
    ]);
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

async function main() {
    if ((process.stdout as any)._handle) (process.stdout as any)._handle.setBlocking(true);

    const packageDir = process.argv[2] || ".";
    const distDir = process.argv[3] || path.join(process.cwd(), "dist");
    const context: SourcePackage[] = [];
    const rootDep: ResolvedPackage = {
        sourceDir: packageDir,
        name: "root",
        version: "n/a",
        users: [],
        deps: [],
        targetDir: distDir,
        level: 0
    };
    processPackage(rootDep, context);

    const packages = assignTargetDirs(context, rootDep);

    console.log("$ copy-production-deps: found packages");
    for (const d of packages) {
        console.log(
            `${d.name}@${d.version} [${d.level}] from ${d.sourceDir} -> ${relative(d.targetDir)}`
        );
    }

    /*
    if (errors === 0) {
        // await emptyDirSync(distDir);
        for (const dependencyPath of paths) {
            const dependencyDistPath = path.join(distDir, path.basename(dependencyPath));
            console.log(`${dependencyPath} -> ${dependencyDistPath}`);
            // await removeSync(dependencyDistPath);
            // await copy(dependencyPath + "/", dependencyDistPath + "/");
        }
    }
    */
    process.exit(errors === 0 ? 0 : 1);
}

main().catch(error => {
    console.error(`copy-production-deps: failed: ${error}`, error);
    process.exit(2);
});
