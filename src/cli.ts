#!/usr/bin/env node

import { SourcePackage, relative, copyProductionDeps, CopyProductionDepsOptions } from "./copy-production-deps";
import * as path from "path";
import * as fs from "fs";
import yargs from "yargs";
import minimatch from "minimatch";

async function main() {
    if ((process.stdout as any)._handle) (process.stdout as any)._handle.setBlocking(true);

    yargs
        .scriptName("copy-production-deps")
        //.usage("Usage: $0 <srcDir> <distDir>")
        .option("dryRun", {
            alias: "n",
            type: "boolean",
            description: "Dry run - only show what would be copied.",
            default: false
        })
        .option("verbose", {
            alias: "v",
            type: "boolean",
            description: "Run with verbose logging",
            default: false
        })
        .option("exclude-from", {
            type: "array",
            description: "Read ecluded file patterns from file one pattern a line.",
            default: [] as string[]
        })
        .option("exclude", {
            type: "array",
            description: "Exclude file pattern (minimatch glob)",
            default: [] as string[]
        })
        .command(
            "$0 [packageDir] [distDir]",
            "copy production deps from Npm/Yarn workspace to dist folder",
            (yargs) => {
                return yargs
                    .positional("packageDir", {
                        describe: "source package folder (must contain package.json)",
                        demandOption: false,
                        default: "."
                    })
                    .positional("distDir", {
                        describe: "distribution directory (packages will be copied to ${distDir}/node_modules)",
                        demandOption: false,
                        default: "./dist"
                    });
            },
            (argv) => {
                const packageDir = path.resolve(process.cwd(), argv.packageDir);
                const distDir = path.resolve(process.cwd(), argv.distDir);
                let copyFilters: Array<(src: string) => boolean> = [];
                const allExcludedGlobs = [...argv.exclude];
                for (const excludeFrom of argv["exclude-from"]) {
                    const lines = fs
                        .readFileSync(excludeFrom, "utf-8")
                        .split("\n")
                        .filter((line) => line && !line.startsWith("#"));
                    allExcludedGlobs.push(...lines);
                }
                const excludeFilterOptions: minimatch.IOptions = { matchBase: true };
                for (const excludedGlob of argv.exclude) {
                    copyFilters.push((minimatch.filter(excludedGlob, excludeFilterOptions) as unknown) as any);
                }
                const excludePaths =
                    copyFilters.length > 0
                        ? (src: string) => copyFilters.reduce((r, filter) => r || filter(src), false)
                        : undefined;
                const options: CopyProductionDepsOptions = {
                    dryRun: argv.dryRun,
                    verbose: argv.verbose,
                    excludePaths: excludePaths
                };
                copyProductionDeps(packageDir, distDir, options);
            }
        )

        .demandCommand()
        .help().argv;
}

main().catch((error) => {
    console.error(`copy-production-deps: failed: ${error}`, error);
    if (Array.isArray(error.badPackages)) {
        for (const badPackage of error.badPackages) {
            const users = badPackage.users.map((u: SourcePackage) => relative(u.sourceDir)).join(", ");
            console.error(`${badPackage.name}@${badPackage.version} not found as needed by ${users}`);
        }
    }
    process.exit(2);
});
