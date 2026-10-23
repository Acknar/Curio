// Curio frontend build. Uses the standard Nextcloud Vue webpack
// config (entry src/main.js -> js/curio-main.js, styles injected at runtime).
const nextcloudConfig = require('@nextcloud/webpack-vue-config')

// The map engine (MapLibre, loaded on demand) goes into one js/curio-maplibre.js
// chunk instead of webpack's automatic vendor split with a long generated name.
nextcloudConfig.optimization.splitChunks = {
	...nextcloudConfig.optimization.splitChunks,
	cacheGroups: { defaultVendors: false },
}

module.exports = nextcloudConfig
