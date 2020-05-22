const deepcopy = require('deepcopy');
const chalk = require('chalk');
const BABEL_LOADER_NAME = 'babel-loader';
/**
 * Find all possible incarnations of preset-env:
 *   "env"
 *   "@babel/preset-env"
 *   "node_modules/@babel/preset-env"
 *   "node_modules/@babel/preset-env/index.js"
 */
const IS_PRESET_ENV = /((^|[\/\\])@babel[\/\\]preset-env([\/\\]|$)|^env$)/;

/**
 * Takes the current options and returns it with @babel/preset-env's target set to {"esmodules": true}.
 * @param {Object} options
 */
export const makeESMPresetOptions = (options: any) => {
	let found = false;
	options = options || {};
	options.presets = (options.presets || []).filter((preset: any) => {
		const name = Array.isArray(preset) ? preset[0] : preset;
		if (IS_PRESET_ENV.test(name) && preset[1]) {
			found = true;
			let presetOptions = preset[1];
			presetOptions.targets = presetOptions.targets || {};
			presetOptions.targets = { esmodules: true };
			presetOptions.bugfixes = true;
		}
		return true;
	});
	if (!found) {
		console.log(chalk.yellow('Adding @babel/preset-env because it was not found'));
		options.presets.push(['@babel/preset-env', { targets: { esmodules: true } }]);
	}
	return options;
};

/**
 * Returns a copy of current babel-loader config.
 * @param {Object} config
 */
export const getBabelLoaderOptions = (config: any) => {
	return deepcopy(getBabelLoader(config).options);
};

/**
 * Returns a ref to babel-config
 * @param {Object} config
 */
export const getBabelLoader = (config: any) => {
	let babelConfig: any = null;
	config.module.rules.forEach((rule: any) => {
		if (!babelConfig) {
			if (rule.use && Array.isArray(rule.use)) {
				rule.use.forEach((rule: any) => {
					if (rule.loader && rule.loader.includes(BABEL_LOADER_NAME)) {
						babelConfig = rule;
					}
				});
			} else if (
				(rule.use && rule.use.loader && rule.use.loader.includes(BABEL_LOADER_NAME)) ||
				(rule.loader && rule.loader.includes(BABEL_LOADER_NAME))
			) {
				babelConfig = rule.use || rule;
			}
		}
	});
	if (!babelConfig) {
		throw new Error('Babel-loader config not found!!!');
	} else {
		return babelConfig;
	}
};
