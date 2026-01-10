const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const sveltePreprocess = require('svelte-preprocess');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  const preprocess = sveltePreprocess({
    typescript: {
      tsconfigFile: path.resolve(__dirname, 'tsconfig.svelte.json')
    }
  });

  return {
    entry: {
      main: './src/lib/index.js'
    },
    output: {
      path: path.resolve(__dirname, 'matterviz_dash_components'),
      filename: 'matterviz_dash_components.min.js',
      library: {
        name: 'matterviz_dash_components',
        type: 'umd'
      },
      globalObject: 'this',
      // Public path is set dynamically at runtime (see src/lib/publicPath.js)
      publicPath: ''
    },
    devtool: isProd ? false : 'source-map',
    externals: {
      react: 'React',
      'react-dom': 'ReactDOM'
    },
    resolve: {
      alias: {
        // MatterViz ships most source as dist/*.svelte but does not necessarily
        // export the ./dist subpath via package.json "exports".
        // This alias lets us require.context(...) the physical dist folder.
        'matterviz-dist': path.resolve('node_modules', 'matterviz', 'dist')
      },
      fullySpecified: false,
      byDependency: {
        esm: {
          fullySpecified: false
        }
      },
      extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.svelte'],
      mainFields: ['svelte', 'browser', 'module', 'main'],
      conditionNames: ['svelte', 'browser', 'import', 'require', 'default']
    },
    experiments: {
      asyncWebAssembly: true
    },
    module: {
      rules: [
        {
          test: /\.m?[jt]sx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', { targets: 'defaults' }],
                ['@babel/preset-react', { runtime: 'automatic' }],
                ['@babel/preset-typescript']
              ]
            }
          }
        },
        {
          // Svelte custom element wrappers (only these are compiled as custom elements)
          test: /\.ce\.svelte$/,
          use: {
            loader: 'svelte-loader',
            options: {
              compilerOptions: {
                customElement: true,
                dev: !isProd,
                runes: false
              },
              preprocess,
              emitCss: true
            }
          }
        },
        {
          // Regular Svelte components (MatterViz + its dependencies)
          test: /\.(svelte|svelte\.js)$/,
          exclude: /\.ce\.svelte$/,
          use: {
            loader: 'svelte-loader',
            options: {
              compilerOptions: {
                dev: !isProd,
                runes: true
              },
              preprocess,
              emitCss: true
            }
          }
        },
        {
          // Workaround for Svelte on Webpack 5+ (see svelte-loader README)
          test: /node_modules\/svelte\/.*\.mjs$/,
          resolve: {
            fullySpecified: false
          }
        },
        {
          // MatterViz ESM files import siblings without extensions; allow extensionless resolution
          test: /node_modules\/matterviz\/dist\/.*\.js$/,
          resolve: {
            fullySpecified: false
          }
        },
        {
          // svelte-multiselect bundled with MatterViz also imports extensionless modules
          test: /node_modules\/svelte-multiselect\/dist\/.*\.js$/,
          resolve: {
            fullySpecified: false
          }
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, { loader: 'css-loader' }]
        },
        {
          test: /\.wasm$/,
          type: 'asset/resource',
          generator: {
            // Emit a stable filename so we can reference it from Python.
            filename: 'matterviz_wasm.wasm'
          }
        },
        {
          test: /\.(png|jpe?g|gif|svg|woff2?|eot|ttf|otf)$/,
          type: 'asset/resource'
        }
      ]
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: 'matterviz_dash_components.css'
      })
    ],
    optimization: {
      minimize: isProd
    }
  };
};
