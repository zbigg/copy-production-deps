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
import minimatch from "minimatch";
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

// async function loadJson(filePath: string) {
//     return JSON.parse(await fs.promises.readFile(filePath, "utf-8"));
// }

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

                    // Only process this package, if we're the first user.
                    if (newDep.users.length === 1) {
                        subPackages.push(newDep);
                    }
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
    const localDependencies = Object.keys(packageJson.dependencies || {}).map((name) => {
        return {
            name,
            version: packageJson.dependencies[name]
        };
    });

    lookForDependenciesInWorkspace(pkg, localDependencies, context);
}

export function assignTargetDirs(allPackages: Context, rootPkg: ResolvedPackage): ResolvedPackage[] {
    const byName: Map<string, SourcePackage[]> = new Map();
    for (const dr of allPackages.filter(isProperSourcePackage)) {
        const packageResults = byName.get(dr.name);
        if (packageResults === undefined) {
            byName.set(dr.name, [dr]);
        } else {
            packageResults.push(dr);
        }
        debug(`found ${relative(dr.sourceDir)} used by ${dr.users.map((u) => relative(u.sourceDir)).join(", ")}`);
    }
    const depToResolved: Map<SourcePackage, ResolvedPackage> = new Map();
    const result: ResolvedPackage[] = [];
    const targetDirs: Map<string, Map<string, ResolvedPackage>> = new Map();

    const rootNodeModules = path.join(rootPkg.targetDir, "node_modules");

    const resolve = (pkg: SourcePackage, user: ResolvedPackage): ResolvedPackage => {
        const allVersionsOfMe = byName.get(pkg.name)!;
        const imTheOnlyOne = allVersionsOfMe.length === 1;
        const usedByRoot = pkg.users.includes(rootPkg);
        if (imTheOnlyOne || usedByRoot) {
            const targetDir = path.join(rootNodeModules, pkg.name);
            return {
                ...pkg,
                targetDir
            };
        }

        // Search if there are other resolved ones with same version
        // up there in tree
        const resolvedVersions = allVersionsOfMe.map((p) => p !== pkg && depToResolved.get(p));
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

        if (pkg.users.length === 1) {
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
        // not the only one and not used by root
        const startNodeModules = path.join(user.targetDir, "node_modules");
        let previousTargetDir: string | undefined;
        let currentNodeModules = startNodeModules;
        let currentUser = user;
        while (true) {
            let currentTargetDir = path.join(currentNodeModules, pkg.name);
            if (previousTargetDir !== undefined && targetDirs.has(currentTargetDir)) {
                // we're in invalid position!, we have to step back!
                return {
                    ...pkg,
                    targetDir: previousTargetDir
                };
            }
            const candidate = { ...pkg, targetDir: currentTargetDir };
            const score = pkg.users.reduce((r, u) => {
                const ru = depToResolved.get(u);
                if (!ru) {
                    return r;
                }
                return r + (isResolvable(candidate, ru) ? 1 : 0);
            }, 0);
            const perfectScore = score === pkg.users.length;
            if (perfectScore) {
                return candidate;
            }
            if (currentNodeModules === rootNodeModules) {
                // we can't find better place, just return candidate
                return candidate;
            }
            previousTargetDir = currentTargetDir;
            if (!currentUser.parent) {
                return candidate;
            }
            currentUser = currentUser.parent;
            const previousNodeModules = currentNodeModules;
            currentNodeModules = path.join(currentUser.targetDir, "node_modules");

            if (previousNodeModules === currentNodeModules) {
                throw new Error("#assignTargetDirs reached root, report this as bug");
            }
        }
    };
    const packagesToResolve: [SourcePackage, ResolvedPackage][] = rootPkg.deps.map((d) => [d, rootPkg]);
    const allResolved: Set<ResolvedPackage> = new Set();
    const getResolved = (pkg: SourcePackage, user: ResolvedPackage): ResolvedPackage => {
        let r = depToResolved.get(pkg);
        if (r === undefined) {
            r = resolve(pkg, user);
            depToResolved.set(pkg, r);
            if (!allResolved.has(r)) {
                const targetDirMap =
                    targetDirs.get(r.targetDir) ||
                    (() => {
                        const m = new Map();
                        targetDirs.set(r.targetDir, m);
                        return m;
                    })();
                targetDirMap.set(r.name, r);
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
    onlyPackages?: string[];
    excludePaths?: (srcFileName: string) => boolean;
}

export function parseBasicPatternList(text: string): string[] {
    return text
        .split("\n")
        .map((text) => text.trim())
        .filter((line) => line && !line.startsWith("#"));
}

// source: https://docs.npmjs.com/using-npm/developers.html
const defaultNpmIngnorePatterns = [
    "node_modules",
    ".npmignore",
    "._*",
    ".DS_Store",
    ".git",
    ".hg",
    ".npmrc",
    ".lock-wscript",
    ".svn",
    ".wafpickle-*",
    "config.gypi",
    "CVS",
    "npm-debug.log",
    ".*.swp"
];

// const defaultNpmAlwaysIncludePattens = ["package.json", "LICENSE*", "README*"];

const globFilterOptions: minimatch.IOptions = { matchBase: true };

/**
 * Creates filter function that returnes `true` if any of filter matches
 */
export function globListFilter(patterns: string[]): (src: string) => boolean {
    const filters = patterns.map((pattern) => minimatch.filter(pattern, globFilterOptions) as (src: string) => boolean);
    return (src: string) => filters.reduce((r, filter) => r || filter(src), false);
}

/**
 * Return filter for files in specific package.
 *
 * This filter returns `true` for files that should be in dist package and `false` for ignored
 * (or not explicitly listed files).
 */
export async function getPackageSpecificFilter(pkg: ResolvedPackage): Promise<(src: string) => boolean> {
    // const packageJson = await loadJson(path.join(pkg.sourceDir, "package.json"));
    const packageNpmIgnore = path.join(pkg.sourceDir, ".npmignore");

    let npmIgnorePatterns = defaultNpmIngnorePatterns;
    // let npmIncludePaths = defaultNpmAlwaysIncludePattens;
    if (fs.existsSync(packageNpmIgnore)) {
        npmIgnorePatterns = [
            ...npmIgnorePatterns,
            ...parseBasicPatternList(await fs.promises.readFile(packageNpmIgnore, "utf-8"))
        ];
    }
    let hasExplicitFileList = false;
    // if (Array.isArray(packageJson.files) && packageJson.files.length > 0) {
    //     hasExplicitFileList = true;
    //     npmIncludePaths = [...npmIncludePaths, ...packageJson.files];
    // }

    const ignoreFilter = globListFilter(npmIgnorePatterns.filter((pattern) => !pattern.startsWith("!")));
    const unIgnoreFilter = globListFilter(
        npmIgnorePatterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.substr(1))
    );
    //const includeFilter = globListFilter(npmIncludePaths);

    return (packagePath) => {
        if (packagePath === "" || packagePath === ".") {
            return true;
        }

        // if (includeFilter(packagePath)) {
        //     return true;
        // }

        if (ignoreFilter(packagePath)) {
            if (unIgnoreFilter(packagePath)) {
                return true;
            }
            return false;
        }

        return hasExplicitFileList === false;
    };
}

export async function copyProductionDeps(
    sourceDir: string,
    targetDir: string,
    options: CopyProductionDepsOptions = {}
): Promise<ResolvedPackage[]> {
    const context: Context = [];
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
    if (options.onlyPackages) {
        rootDep.deps = rootDep.deps.filter((d) => options.onlyPackages?.includes(d.name));
        console.error(`copy-production-deps: only bundling deps of ${options.onlyPackages}`);
    }
    const targetPackages = assignTargetDirs(context, rootDep);

    const targetNodeModules = path.join(targetDir, "node_modules");
    debug(`removing ${targetNodeModules}`);
    if (!options.dryRun) {
        fsExtra.removeSync(targetNodeModules);
        fsExtra.ensureDirSync(targetNodeModules);
    }

    for (const resolvedDependency of targetPackages) {
        const sourceDirAbs = absolute(resolvedDependency.sourceDir);
        const skipDep = options.excludePaths ? options.excludePaths(sourceDirAbs) : false;
        debug("filter", sourceDirAbs, !skipDep);
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
        const packageFilter = await getPackageSpecificFilter(resolvedDependency);
        await fsExtra.copy(sourceDirAbs + "/", resolvedDependency.targetDir + "/", {
            recursive: true,
            filter: (absolutePath: string) => {
                const packagePath = absolutePath.substr(sourceDirAbs.length + 1);
                let verdict = packageFilter(packagePath);
                verdict = verdict && (options.excludePaths ? !options.excludePaths(absolutePath) : true);
                debug("filter", absolutePath, verdict);
                return verdict && !options.dryRun;
            }
        });
    }
    return targetPackages;
}
