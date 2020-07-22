import { assert } from "chai";
import {
    processPackage,
    assignTargetDirs,
    SourcePackage,
    ResolvedPackage,
    copyProductionDeps,
    Dependency
} from "./copy-production-deps";
import mockFs from "mock-fs";
import _ from "lodash";
import * as path from "path";
import * as fs from "fs";

function assertPackageExists(context: string, pkg: Dependency) {
    const packageFolder = path.join(context, "node_modules", pkg.name);

    assert.isTrue(fs.existsSync(packageFolder), `'${packageFolder}' exists`);
    assert.isTrue(fs.statSync(packageFolder).isDirectory(), `'${packageFolder}' is directory`);
    const packageJsonPath = path.join(packageFolder, "package.json");

    assert.isTrue(fs.existsSync(packageJsonPath), `'${packageFolder}' exists`);
    assert.isTrue(fs.statSync(packageJsonPath).isFile(), `'${packageFolder}' is file`);

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    assert.equal(packageJson.name, pkg.name);
    assert.equal(packageJson.version, pkg.version);
}

describe("copy-production-deps", function () {
    describe("use case #1 - simple transitive dependency", function () {
        before(function () {
            mockFs({
                foopath: {
                    "package.json": JSON.stringify({
                        name: "foo",
                        version: "0.1.0",
                        dependencies: {
                            a: "^1.0.0",
                            b: "^1.0.0"
                        }
                    }),
                    node_modules: {
                        a: {
                            "package.json": JSON.stringify({
                                name: "a",
                                version: "1.0.0",
                                dependencies: {
                                    b: "^1.0.0"
                                }
                            })
                        },
                        b: {
                            "package.json": JSON.stringify({
                                name: "b",
                                version: "1.0.0",
                                dependencies: {
                                    // THIS provokes infinite loop!error!
                                    // b: "^1.0.0"
                                    c: "^1.0.0"
                                    //d: "^1.0.0"
                                }
                            })
                        },
                        c: {
                            "package.json": JSON.stringify({
                                name: "c",
                                version: "1.0.0"
                            })
                        },
                        d: {
                            "package.json": JSON.stringify({
                                name: "d",
                                version: "1.0.0"
                            })
                        }
                    }
                }
            });
        });
        after(function () {
            mockFs.restore();
        });
        const context: SourcePackage[] = [];
        const rootDep: ResolvedPackage = {
            sourceDir: "foopath",
            name: "root",
            version: "n/a",
            users: [],
            deps: [],
            targetDir: "THE-TARGET",
            level: 0
        };
        it("#processPackage finds all packages", function () {
            processPackage(rootDep, context);

            const interestingContext = context.map((r) => _.pick(r, ["name", "sourceDir"]));
            assert.includeDeepMembers(interestingContext as any, [
                {
                    name: "a",
                    sourceDir: "foopath/node_modules/a"
                },
                {
                    name: "b",
                    sourceDir: "foopath/node_modules/b"
                },
                {
                    name: "c",
                    sourceDir: "foopath/node_modules/c"
                }
            ]);
            assert.notDeepNestedInclude(interestingContext as any, {
                name: "d",
                sourceDir: "foopath/node_modules/d"
            });
        });
        it("#assignTargetDirs emits target folders", function () {
            const testedPackages = assignTargetDirs(context, rootDep).map((r) =>
                _.pick(r, ["name", "sourceDir", "targetDir"])
            );
            assert.includeDeepMembers(testedPackages as any, [
                {
                    name: "a",
                    sourceDir: "foopath/node_modules/a",
                    targetDir: "THE-TARGET/node_modules/a"
                },
                {
                    name: "b",
                    sourceDir: "foopath/node_modules/b",
                    targetDir: "THE-TARGET/node_modules/b"
                },
                {
                    name: "c",
                    sourceDir: "foopath/node_modules/c",
                    targetDir: "THE-TARGET/node_modules/c"
                }
            ]);
            assert.notDeepNestedInclude(testedPackages as any, {
                name: "d",
                sourceDir: "foopath/node_modules/d",
                targetDir: "THE-TARGET/node_modules/d"
            });
        });
        it("#copyProductionDeps copies files to proper places", async function () {
            await copyProductionDeps("foopath", "dist/");

            assertPackageExists("./dist", { name: "a", version: "1.0.0" });
            assertPackageExists("./dist", { name: "b", version: "1.0.0" });
            assertPackageExists("./dist", { name: "c", version: "1.0.0" });
        });
    });

    describe("use case #2 - yarn-workspace like module with messed dependencies", function () {
        before(function () {
            mockFs({
                workspaceRoot: {
                    "foo-backend": {
                        "package.json": JSON.stringify({
                            name: "foo",
                            version: "0.1.0",
                            dependencies: {
                                a: "^1.0.0",
                                b: "^0.1.0",
                                d: "^1.0.0",
                                r1: "^1.0.0",
                                r2: "^1.0.0",
                                r3: "^1.0.0"
                            },
                            devDependencies: {
                                x: "^1.0.0"
                            }
                        }),
                        node_modules: {
                            b: {
                                "package.json": JSON.stringify({
                                    name: "b",
                                    version: "0.1.0"
                                })
                            },
                            d: {
                                "package.json": JSON.stringify({
                                    name: "d",
                                    version: "1.0.0"
                                })
                            },
                            x: {
                                "package.json": JSON.stringify({
                                    name: "x",
                                    version: "1.0.0"
                                })
                            },
                            r1: {
                                "package.json": JSON.stringify({
                                    name: "r1",
                                    version: "1.0.0",
                                    dependencies: {
                                        s: "1.0.0"
                                    }
                                })
                            },
                            r2: {
                                "package.json": JSON.stringify({
                                    name: "r2",
                                    version: "1.0.0",
                                    dependencies: {
                                        s: "1.0.0"
                                    }
                                })
                            },
                            r3: {
                                "package.json": JSON.stringify({
                                    name: "r3",
                                    version: "1.0.0",
                                    dependencies: {
                                        s: "2.0.0"
                                    }
                                }),
                                node_modules: {
                                    s: {
                                        "package.json": JSON.stringify({
                                            name: "s",
                                            version: "2.0.0"
                                        })
                                    }
                                }
                            },
                            s: {
                                "package.json": JSON.stringify({
                                    name: "s",
                                    version: "1.0.0"
                                })
                            }
                        }
                    },
                    node_modules: {
                        a: {
                            "package.json": JSON.stringify({
                                name: "a",
                                version: "1.0.0",
                                dependencies: {
                                    b: "^1.0.0"
                                }
                            })
                        },
                        b: {
                            "package.json": JSON.stringify({
                                name: "b",
                                version: "1.0.0",
                                dependencies: {
                                    c: "^2.0.0"
                                }
                            })
                        },
                        c: {
                            "package.json": JSON.stringify({
                                name: "c",
                                version: "2.0.0"
                            })
                        }
                    }
                }
            });
        });
        after(function () {
            mockFs.restore();
        });
        const context: SourcePackage[] = [];
        const rootDep: ResolvedPackage = {
            sourceDir: "workspaceRoot/foo-backend",
            name: "root",
            version: "n/a",
            users: [],
            deps: [],
            targetDir: "THE-TARGET",
            level: 0
        };
        it("#processPackage finds all packages", function () {
            processPackage(rootDep, context);

            const interestingContext = context.map((r) => _.pick(r, ["name", "sourceDir", "version"]));
            assert.includeDeepMembers(interestingContext as any, [
                {
                    name: "a",
                    sourceDir: "workspaceRoot/node_modules/a",
                    version: "1.0.0"
                },
                {
                    name: "b",
                    sourceDir: "workspaceRoot/node_modules/b",
                    version: "1.0.0"
                },
                {
                    name: "b",
                    sourceDir: "workspaceRoot/foo-backend/node_modules/b",
                    version: "0.1.0"
                },
                {
                    name: "c",
                    sourceDir: "workspaceRoot/node_modules/c",
                    version: "2.0.0"
                },
                {
                    name: "r1",
                    sourceDir: "workspaceRoot/foo-backend/node_modules/r1",
                    version: "1.0.0"
                },
                {
                    name: "s",
                    sourceDir: "workspaceRoot/foo-backend/node_modules/r3/node_modules/s",
                    version: "2.0.0"
                }
            ]);
            assert.notDeepNestedInclude(interestingContext as any, {
                name: "x",
                sourceDir: "workspaceRoot/foo-backend/node_modules/x",
                version: "1.0.0"
            });
        });
        it("#assignTargetDirs emits target folders", function () {
            const testedPackages = assignTargetDirs(context, rootDep).map((r) =>
                _.pick(r, ["name", "sourceDir", "targetDir", "version"])
            );
            assert.includeDeepMembers(testedPackages as any, [
                {
                    name: "a",
                    sourceDir: "workspaceRoot/node_modules/a",
                    targetDir: "THE-TARGET/node_modules/a",
                    version: "1.0.0"
                },
                {
                    name: "b",
                    sourceDir: "workspaceRoot/foo-backend/node_modules/b",
                    targetDir: "THE-TARGET/node_modules/b",
                    version: "0.1.0"
                },
                {
                    name: "b",
                    sourceDir: "workspaceRoot/node_modules/b",
                    targetDir: "THE-TARGET/node_modules/a/node_modules/b",
                    version: "1.0.0"
                },
                {
                    name: "c",
                    sourceDir: "workspaceRoot/node_modules/c",
                    targetDir: "THE-TARGET/node_modules/c",
                    version: "2.0.0"
                },
                {
                    name: "d",
                    sourceDir: "workspaceRoot/foo-backend/node_modules/d",
                    targetDir: "THE-TARGET/node_modules/d",
                    version: "1.0.0"
                }
            ]);
            assert.includeDeepMembers(testedPackages as any, [
                {
                    name: "s",
                    sourceDir: "workspaceRoot/foo-backend/node_modules/s",
                    targetDir: "THE-TARGET/node_modules/s",
                    version: "1.0.0"
                }
            ]);
            assert.notDeepNestedInclude(testedPackages as any, {
                name: "x",
                sourceDir: "workspaceRoot/node_modules/x",
                targetDir: "THE-TARGET/node_modules/x"
            });
        });
        it("#copyProductionDeps copies files to proper places", async function () {
            await copyProductionDeps("workspaceRoot/foo-backend", "dist/");

            assertPackageExists("./dist", { name: "a", version: "1.0.0" });
            assertPackageExists("./dist", { name: "b", version: "0.1.0" });
            assertPackageExists("./dist", { name: "c", version: "2.0.0" });
            assertPackageExists("./dist", { name: "d", version: "1.0.0" });
            assertPackageExists("./dist", { name: "r1", version: "1.0.0" });
            assertPackageExists("./dist", { name: "r2", version: "1.0.0" });
            assertPackageExists("./dist", { name: "r3", version: "1.0.0" });
            assertPackageExists("./dist", { name: "s", version: "1.0.0" });
            assertPackageExists("./dist/node_modules/r3", { name: "s", version: "2.0.0" });
            assertPackageExists("./dist/node_modules/a", { name: "b", version: "1.0.0" });
        });
    });

    describe("support for cycle in dependency tree (#4)", async function () {
        before(function () {
            mockFs({
                foopath: {
                    "package.json": JSON.stringify({
                        name: "foo",
                        version: "0.1.0",
                        dependencies: {
                            a: "^1.0.0",
                            b: "^1.0.0"
                        }
                    }),
                    node_modules: {
                        a: {
                            "package.json": JSON.stringify({
                                name: "a",
                                version: "1.0.0",
                                dependencies: {
                                    b: "^1.0.0"
                                }
                            })
                        },
                        b: {
                            "package.json": JSON.stringify({
                                name: "b",
                                version: "1.0.0",
                                dependencies: {
                                    a: "^1.0.0"
                                }
                            })
                        }
                    }
                }
            });
        });
        after(function () {
            mockFs.restore();
        });
        const context: SourcePackage[] = [];
        const rootDep: ResolvedPackage = {
            sourceDir: "foopath",
            name: "root",
            version: "n/a",
            users: [],
            deps: [],
            targetDir: "THE-TARGET",
            level: 0
        };
        it("#processPackage finds all packages", function () {
            processPackage(rootDep, context);

            const interestingContext = context.map((r) => _.pick(r, ["name", "sourceDir"]));
            assert.includeDeepMembers(interestingContext as any, [
                {
                    name: "a",
                    sourceDir: "foopath/node_modules/a"
                },
                {
                    name: "b",
                    sourceDir: "foopath/node_modules/b"
                }
            ]);
        });
        it("#assignTargetDirs emits target folders", function () {
            const testedPackages = assignTargetDirs(context, rootDep).map((r) =>
                _.pick(r, ["name", "sourceDir", "targetDir"])
            );
            assert.includeDeepMembers(testedPackages as any, [
                {
                    name: "a",
                    sourceDir: "foopath/node_modules/a",
                    targetDir: "THE-TARGET/node_modules/a"
                },
                {
                    name: "b",
                    sourceDir: "foopath/node_modules/b",
                    targetDir: "THE-TARGET/node_modules/b"
                }
            ]);
        });
        it("#copyProductionDeps copies files to proper places", async function () {
            await copyProductionDeps("foopath", "dist/");

            assertPackageExists("./dist", { name: "a", version: "1.0.0" });
            assertPackageExists("./dist", { name: "b", version: "1.0.0" });
        });
    });
});
