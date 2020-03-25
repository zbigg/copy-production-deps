import { SourcePackage, relative, copyProductionDeps, CopyProductionDepsOptions } from "./copy-production-deps";
import * as path from "path";
import yargs from "yargs";

async function main() {
    if ((process.stdout as any)._handle) (process.stdout as any)._handle.setBlocking(true);

    yargs
        .scriptName("copy-production-deps")
        //.usage("Usage: $0 <srcDir> <distDir>")
        .option("dryRun", {
            alias: "n",
            type: "boolean",
            description: "Dry run - only show what would be copied.",
            default: false,
        })
        .option("verbose", {
            alias: "v",
            type: "boolean",
            description: "Run with verbose logging",
            default: false,
        })
        .command(
            "$0 [packageDir] [distDir]",
            "copy production deps from Npm/Yarn workspace to dist folder",
            (yargs) => {
                return yargs
                    .positional("packageDir", {
                        describe: "source package folder (must contain package.json)",
                        demandOption: false,
                        default: ".",
                    })
                    .positional("distDir", {
                        describe: "distribution directory (packages will be copied to ${distDir}/node_modules)",
                        demandOption: false,
                        default: "./dist",
                    });
            },
            (argv) => {
                const packageDir = path.resolve(process.cwd(), argv.packageDir);
                const distDir = path.resolve(process.cwd(), argv.distDir);
                const options: CopyProductionDepsOptions = {
                    dryRun: argv.dryRun,
                    verbose: argv.verbose,
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
