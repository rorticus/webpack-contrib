const deepcopy = require('deepcopy');
const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');
const MultiEntryPlugin = require('webpack/lib/MultiEntryPlugin');
const JsonpTemplatePlugin = require('webpack/lib/web/JsonpTemplatePlugin');
const SplitChunksPlugin = require('webpack/lib/optimize/SplitChunksPlugin');
const RuntimeChunkPlugin = require('webpack/lib/optimize/RuntimeChunkPlugin');

const { makeESMPresetOptions, getBabelLoaderOptions } = require('./babel-utils');

const PLUGIN_NAME = 'BabelEsmPlugin';
const FILENAME = '[name].es6.js';
const CHUNK_FILENAME = '[id].es6.js';

export default class BabelEsmPlugin {
	options: any;
	babelLoaderConfigOptions: any;
	newConfigOptions: any;

	constructor(options: any) {
		this.options = Object.assign(
			{
				filename: FILENAME,
				chunkFilename: CHUNK_FILENAME,
				excludedPlugins: [PLUGIN_NAME],
				additionalPlugins: []
			},
			options
		);
	}

	apply(compiler: any) {
		compiler.hooks.make.tapAsync(PLUGIN_NAME, async (compilation: any, callback: any) => {
			const outputOptions = deepcopy(compiler.options);
			this.babelLoaderConfigOptions = getBabelLoaderOptions(outputOptions);
			this.newConfigOptions = makeESMPresetOptions(this.babelLoaderConfigOptions);
			outputOptions.output.filename = this.options.filename;
			outputOptions.output.chunkFilename = this.options.chunkFilename;
			let plugins = (compiler.options.plugins || []).filter(
				(c: any) => this.options.excludedPlugins.indexOf(c.constructor.name) < 0
			);

			// Add the additionalPlugins
			plugins = plugins.concat(this.options.additionalPlugins);

			/**
			 * We are deliberatly not passing plugins in createChildCompiler.
			 * All webpack does with plugins is to call `apply` method on them
			 * with the childCompiler.
			 * But by then we haven't given childCompiler a fileSystem or other options
			 * which a few plugins might expect while execution the apply method.
			 * We do call the `apply` method of all plugins by ourselves later in the code
			 */
			const childCompiler = compilation.createChildCompiler(PLUGIN_NAME, outputOptions.output);

			childCompiler.context = compiler.context;
			childCompiler.inputFileSystem = compiler.inputFileSystem;
			childCompiler.outputFileSystem = compiler.outputFileSystem;

			// Call the `apply` method of all plugins by ourselves.
			if (Array.isArray(plugins)) {
				for (const plugin of plugins) {
					plugin.apply(childCompiler);
				}
			}

			// All plugin work is done, call the lifecycle hook.
			childCompiler.hooks.afterPlugins.call(childCompiler);

			let entries = compiler.options.entry;
			if (typeof entries === 'function') {
				entries = await entries();
			}
			if (typeof entries === 'string') {
				entries = {
					index: entries
				};
			}

			Object.keys(entries).forEach((entry) => {
				const entryFiles = entries[entry];
				if (Array.isArray(entryFiles)) {
					new MultiEntryPlugin(compiler.context, entryFiles, entry).apply(childCompiler);
				} else {
					new SingleEntryPlugin(compiler.context, entryFiles, entry).apply(childCompiler);
				}
			});

			// Convert entry chunk to entry file
			new JsonpTemplatePlugin().apply(childCompiler);

			if (compiler.options.optimization) {
				if (compiler.options.optimization.splitChunks) {
					new SplitChunksPlugin(Object.assign({}, compiler.options.optimization.splitChunks)).apply(
						childCompiler
					);
				}
				if (compiler.options.optimization.runtimeChunk) {
					new RuntimeChunkPlugin(Object.assign({}, compiler.options.optimization.runtimeChunk)).apply(
						childCompiler
					);
				}
			}

			compilation.hooks.additionalAssets.tapAsync(PLUGIN_NAME, (childProcessDone: any) => {
				let babelLoader;
				childCompiler.options.module.rules.forEach((rule: any, index: any) => {
					if (rule.use) {
						const use = Array.isArray(rule.use) ? rule.use : [rule.use];
						rule.use = use.filter((loader: any) => {
							if (loader && loader.loader === 'babel-loader') {
								return false;
							}
							return true;
						});
					}
				});

				this.options.beforeStartExecution &&
					this.options.beforeStartExecution(plugins, (babelLoader || ({} as any)).options);

				/*
					 * Copy over the parent compilation hash, see issue#15.
					 */
				childCompiler.hooks.make.tapAsync(PLUGIN_NAME, (childCompilation: any, callback: any) => {
					childCompilation.hooks.afterHash.tap(PLUGIN_NAME, () => {
						childCompilation.hash = compilation.hash;
						childCompilation.fullHash = compilation.fullHash;
					});
					callback();
				});

				childCompiler.runAsChild((err: any, entries: any, childCompilation: any) => {
					if (err) {
						return childProcessDone(err);
					}

					if (childCompilation.errors.length > 0) {
						return childProcessDone(childCompilation.errors[0]);
					}

					compilation.assets = Object.assign(childCompilation.assets, compilation.assets);

					compilation.namedChunkGroups = Object.assign(
						childCompilation.namedChunkGroups,
						compilation.namedChunkGroups
					);

					const childChunkFileMap = childCompilation.chunks.reduce((chunkMap: any, chunk: any) => {
						chunkMap[chunk.name] = chunk.files;
						return chunkMap;
					}, {});

					compilation.chunks.forEach((chunk: any) => {
						const childChunkFiles = childChunkFileMap[chunk.name];

						if (childChunkFiles) {
							chunk.files.push(...childChunkFiles.filter((v: any) => !chunk.files.includes(v)));
						}
					});

					childProcessDone();
				});
			});
			callback();
		});
	}
}
