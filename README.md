# Copy node production deps

[![npm](https://img.shields.io/npm/v/copy-production-deps.svg?style=flat-square)](http://www.npmjs.com/package/copy-production-deps)
[![Build status](https://travis-ci.org/zbigg/copy-production-deps.svg?branch=master)](https://travis-ci.org/zbigg/copy-production-deps)
[![codecov](https://codecov.io/gh/zbigg/copy-production-deps/branch/master/graph/badge.svg)](https://codecov.io/gh/zbigg/copy-production-deps)

Find and copy production deps of `package` living in `yarn workspace` to `dist folder`.

**NOTE: This is very experimental package.**, nevertheless it's used in one internal project 
to build minimal `node_modules` for services running in docker.

## Usage

```shell
# copy deps of current folder to ./dist
$ npx copy-production-deps

# copy deps specific package to specific folder
$ npx copy-production-deps packages/foo-backend dist/foo-backend
```

## Doc

Full synopsis:

```
copy-production-deps [packageDir] [distDir]

copy production deps from Npm/Yarn workspace to dist folder

Positionals:
  packageDir  source package folder (must contain package.json)   [default: "."]
  distDir     distribution directory (packages will be copied to
              ${distDir}/node_modules)                       [default: "./dist"]

Options:
  --version       Show version number                                  [boolean]
  --dryRun, -n    Dry run - only show what would be copied.
                                                      [boolean] [default: false]
  --verbose, -v   Run with verbose logging            [boolean] [default: false]
  --exclude-from  Read ecluded file patterns from file one pattern a line.
                                                           [array] [default: []]
  --exclude       Exclude file pattern (minimatch glob)    [array] [default: []]
  --help          Show help                                            [boolean]


```

## Why

Born from frustration that both `yarn` and `npm` have several bugs related to `--production` install and i almost wrote everywhere before i found [copy-node-modules](https://github.com/arloliu/copy-node-modules#readme)

## Contribute

PRs accepted.

## License

MIT © Zbigniew Zagórski
