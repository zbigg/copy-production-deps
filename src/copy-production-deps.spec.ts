import { assert } from "chai";
import { processPackage, assignTargetDirs, SourcePackage, ResolvedPackage, relative } from "./copy-production-deps";
import mockFs from "mock-fs";
import _ from "lodash";

describe("copy-production-deps", function() {
    describe("use case #1 - simple transitive dependency", function() {
        before(function() {
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
        after(function() {
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
        it("#processPackage finds all packages", function() {
            processPackage(rootDep, context);

            const interestingContext = context.map(r => _.pick(r, ["name", "sourceDir"]));
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
        it("#assignTargetDirs emits target folders", function() {
            const testedPackages = assignTargetDirs(context, rootDep).map(r =>
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
    });
});
