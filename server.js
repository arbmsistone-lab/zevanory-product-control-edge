// Legacy AppDeploy facade intentionally disabled.
// Canonical runtime entrypoint is server.ts via "npm start".
// This guard fails closed if an obsolete startup path is invoked.

console.error('legacy_server_js_disabled_use_npm_start');
process.exit(1);
