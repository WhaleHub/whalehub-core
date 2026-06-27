const { ProvidePlugin } = require('webpack');
const path = require('path');

module.exports = {
    webpack: function (config, env) {
        return {
            ...config,
            module: {
                ...config.module,
                rules: [
                    ...config.module.rules,
                    {
                        test: /\.m?[jt]sx?$/,
                        resolve: {
                            fullySpecified: false,
                        },
                    },
                ],
            },
            plugins: [
                ...config.plugins,
                new ProvidePlugin({
                    process: 'process/browser',
                    Buffer: ["buffer", "Buffer"],
                }),
            ],
            resolve: {
                ...config.resolve,
                alias: {
                    ...config.resolve.alias,
                    // The v2 wallet-kit pulls @scure/bip32, which imports
                    // "@noble/hashes/legacy". Some nested @noble/hashes@1.4.0 copies don't
                    // export "./legacy"; dedupe to the top-level 1.8.0 which does.
                    '@noble/hashes': path.resolve(__dirname, 'node_modules/@noble/hashes'),
                },
                fallback: {
                    assert: require.resolve('assert'),
                    buffer: require.resolve('buffer'),
                    crypto: require.resolve('crypto-browserify'),
                    http: require.resolve('stream-http'),
                    https: require.resolve('https-browserify'),
                    stream: require.resolve('stream-browserify'),
                    url: require.resolve('url/'),
                    zlib: require.resolve('browserify-zlib'),
                    path: require.resolve('path-browserify'),
                },
            },
            ignoreWarnings: [/Failed to parse source map/],
        };
    },
    devServer: function (configFunction) {
        return function (proxy, allowedHost) {
            const config = configFunction(proxy, allowedHost);
            config.allowedHosts = 'all';
            return config;
        };
    },
};