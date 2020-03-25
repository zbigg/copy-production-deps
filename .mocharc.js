module.exports = {
    diff: true,
    extension: ["ts"],
    spec: [
        "./src/**/*.spec.ts"
    ],
    reporter: "spec",
    require: "ts-node/register",
    slow: 75,
    timeout: 2000,
    ui: "bdd"
};
