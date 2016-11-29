/*
 * grunt-symfony-dev-assets
 * https://github.com/enemis/grunt-symfony-dev-assets
 *
 * Copyright (c) 2016 Stadnik, Andrey
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

  var path = require('path');
  var fs = require('fs');
  var filesize = require('filesize');
  var bower = require('bower');
  var detective = require('detective');
  var async = require('async');
  var _ = require('lodash');
  _.str = require('underscore.string');
  grunt.registerMultiTask('symfony_dev_assets', 'Create twig two templates. The first one contain all js assets and second one css assets', function() {
    grunt.log.writeln(grunt.util.toArray(this.data));

    var dests = extractMultiDestValues(this.data);

    // Require at least one of [`dest`, `cssDest`, `scssDest`]
    if (Object.keys(dests).length === 0) {
      throw grunt.util.error('You should specify "js" and "css" properties in your Gruntfile.');
    }

    var includes = ensureArray(this.data.include || []);
    var excludes = ensureArray(this.data.exclude || []);
    var bowerOptions = this.data.bowerOptions || {};
    var dependencies = this.data.dependencies || {};
    var includeDev = this.data.includeDev === true;
    var libDir = this.data.libDir;
    libDir.cwd = bower.config.cwd + '/' + libDir.cwd;
    delete this.data.libDir;

    var tasksOpen = dests.length;

    var done = this.async();
    dests.forEach(function(destination) {

      bowerMainFiles(destination, function(files) {
        var type = destination.assetType;

        if (type === 'js') {
          createJSTemplate(destination, files);
        }
        else if (type === 'css') {
          createCSSTemplate(destination, files);
        }
        taskFinished();
      });
    });

    /**
     * As all Filetypes are now handled asynchronously this little helper waits
     * until every filetype is finished and will than call done()
     */
    function taskFinished() {
      tasksOpen--;
      if (tasksOpen === 0) {
        done();
      }
    }

    function extractMultiDestValues(destinations) {
      var destinationConfigs = [];

      Object.keys(destinations).forEach(function(key) {
        destinationConfigs.push(
            {'assetType': key, 'path': destinations[key]}
        );
      });

      return destinationConfigs;
    }

    /**
     * Finds suitable JS and CSS files for all installed Bower packages.
     *
     * @param {Array} Array of Destination Objects [{assetType: {String}, path: {String}}]
     * @param {Function} allDone function(bowerFiles) {}
     */
    function bowerMainFiles(destination, allDone) {
      async.parallel({
        map: bowerList('map'),
        components: bowerList('paths')
      }, function(err, lists) {
        // Ensure all manual defined dependencies are contained in an array
        if (dependencies) {
          _.map(dependencies, function(value, key) {
            dependencies[key] = ensureArray(value);
          });
        }

        // Exclude devDependencies
        var devDependencies = lists.map.pkgMeta.devDependencies;
        if (devDependencies && !includeDev) {
          excludes = excludes.concat(Object.keys(devDependencies));
        }

        // Resolve dependency graph to ensure correct order of components when concat them
        var resolvedDependencies = resolveDependencies(lists.map);

        // List of main files
        var files = {};

        _.each(lists.components, function(component, name) {
          if (includes.length && _.indexOf(includes, name) === -1) return;
          if (excludes.length && _.indexOf(excludes, name) !== -1) return;

          var mainFiles = findMainFiles(name, component, lists.map.dependencies[name], destination);
          if (mainFiles.length) {
            files[name] = mainFiles;
          }
          else {
            // Try to find and concat minispade package: packages/_name_/lib/main.js
            var pkg = getNpmPackage(name, component);
            if (pkg) {
              files[name] = pkg;
            }
            else {
              if(destination.assetType == 'js') {
                grunt.log.error('Can’t detect any *.' + destination.assetType + ' on files for "' +
                    name + '" component. ' +
                    'You should explicitly define it via  mainFiles option. '
                );
              }
            }
          }
        });

        // Gather files by respecting the order of resolved dependencies
        var modules = [];
        _.each(resolvedDependencies, function(name) {
          if (files[name]) {
            modules = modules.concat(files[name]);
          }
        });

        allDone(modules);
      });
    }

    /**
     * Returns function that invokes `list` command of Bower API.
     * Should be used inside async.parallel.
     *
     * @param {String} kind map|paths
     * @return {Function}
     */
    function bowerList(kind) {
      return function(done) {
        var params = _.extend({}, bowerOptions);
        params[kind] = true;
        bower.commands.list(params, {offline: true})
            .on('error', grunt.fail.fatal.bind(grunt.fail))
            .on('end', function(data) {
              done(null, data);  // null means "no error" for async.parallel
            });
      };
    }

    /**
     * Builds dependency graph.
     * See lib/dependencyTools.js.
     *
     * @param {Object} map Map from bower.commands.list(kind: map).
     * @return {Array}
     */
    function resolveDependencies(map) {
      var dependencyGraph = dependencies || {};
      var resolved = [];
      var unresolved = [];

      // Build dependency graph
      if (map.dependencies) {
        buildDependencyGraph(
            undefined,  // First recursion without a start value
            map.dependencies,
            dependencyGraph
        );

        // Flatten/resolve the dependency tree
        resolveDependencyGraph(
            undefined,  // First recursion without a start value
            resolved,
            unresolved,
            dependencyGraph
        );
      }

      return resolved;
    }

    /**
     * Finds main JS and CSS files for a component.
     *
     * @param {String} name Component name.
     * @param {Array|String} component Item from bower.commands.list(kind: list).
     * @param {Object} meta Item from bower.commands.list(kind: map).
     * @return {Array}
     */
    function findMainFiles(name, component, meta, destination) {
      grunt.verbose.writeln();
      grunt.verbose.writeln('Finding main file for ' + name + '...');
      var mainFiles = ensureArray(component);
      var mains = destination.path.mainFiles || {};
      // Main file explicitly defined in bower_concat options
      if (mains[name]) {
        var componentDir = path.join(libDir.cwd, libDir.dir, name);
        var manualMainFiles = ensureArray(mains[name]);
        manualMainFiles = _.map(manualMainFiles, joinPathWith(componentDir));
        grunt.verbose.writeln('Main file was specified in mainFiles options: ' + manualMainFiles);
        return manualMainFiles;
      }

      // Bower knows main JS file?
      mainFiles = _.map(mainFiles, joinPathWith(libDir.cwd));
      var mainFiltered = _.filter(mainFiles, function(file) { return isFileExtension(file, '.' + destination.assetType); });

      // Skip Gruntfiles
      mainFiltered = _.filter(mainFiltered, function(filepath) {
        return !/(Gruntfile\.js)|(grunt\.js)$/.test(filepath);
      });
      /**
       * Todo try to find main files in component directories
       */
      //var regexp = new RegExp(/((\w+\.*)*\.min\.\w+)$/);
      //// Get minimifiedFiles if other wont found
      //var minimifiedFiles = _.filter(mainFiltered, function(filepath) {
      //  return regexp.test(filepath);
      //});
      //
      //mainFiltered = _.filter(mainFiltered, function(filepath) {
      //  return !regexp.test(filepath);
      //});

      if (mainFiltered.length) {
        grunt.verbose.writeln('Main file was specified in bower.json: ' + mainFiltered);
        return mainFiltered;
      }

      // Try to find main JS, CSS, SCSS files
      mainFiltered = expandForAll(component, joinPathWith(libDir.cwd, '*.' + destination.assetType));

      if(destination.assetType == 'js') {
        if (mainFiltered.length === 1) {
          // Only one JS file: no doubt it’s main file
          grunt.verbose.writeln('Considering the only JS file in a component’s folder ' +
              'as a main file: ' + jsFiles
          );
          return mainFiltered;
        }
        else {
          // More than one JS file: try to guess
          var bestFile = guessBestFile(name, mainFiltered);
          if (bestFile) {
            grunt.verbose.writeln('Guessing the best JS file in a component’s folder: ' + [bestFile]);
            mainFiltered = [bestFile];
          }
          else {
            grunt.verbose.writeln('Main JS file not found');
          }
        }
      }
      return mainFiltered;
    }

    /**
     * Returns an array as is, converts any other type to an array: [source].
     *
     * @param {Mixed} object
     * @return {Array}
     */
    function ensureArray(object) {
      if (Array.isArray(object))
        return object;
      else
        return [object];
    }

    /**
     * Builds up a dependency graph for using a simple object structure containing the modules as keys and using arrays
     * as dependecy descriptors.
     */

    function buildDependencyGraph(module, dependencies, graph) {
      if (module && !graph[module]) {
        graph[module] = [];
      }

      var dependencyNames = Object.keys(dependencies);
      dependencyNames.forEach(function(dependencyName) {
        var dependency = dependencies[dependencyName];

        if (module && graph[module].indexOf(dependencyName) === -1) {
          graph[module].push(dependencyName);
        }

        // Traverse down to this dependency dependencies:
        // Dependency-ception.
        if (dependency.dependencies) {
          buildDependencyGraph(dependencyName, dependency.dependencies, graph);
        }
      });
    }

    /**
     * Path joiner function factory. Returns function that prepends `pathPart` with `prepend` and appends it with `append`.
     *
     * @param  {Array|String} [prepend] Path parts that will be added before `pathPart`.
     * @param  {Array|String} [append] Path parts that will be added after `pathPart`.
     * @return {Function} function(pathPart) {}
     */
    function joinPathWith(prepend, append) {
      return function(pathPart) {
        // path.join(prepend..., pathPart, append...)
        pathPart = pathPart.split(bower.config.directory).join(libDir.dir);
        var params = ensureArray(prepend || []).concat([pathPart], ensureArray(append || []));
        return path.join.apply(path, params);
      };
    }

    /**
     * Check whether specified path exists, is a file and has .js extension.
     *
     * @param {String} filepath Path of a file.
     * @param {String} extension Extension to check for, including the`.`.
     * @return {Boolean}
     */
    function isFileExtension(filepath, extension) {

      return typeof filepath === 'string' && path.extname(filepath) === extension && fs.existsSync(filepath) &&
          fs.lstatSync(filepath).isFile()
          ;
    }

    function getNpmPackage(name, component) {
      var pkg = findPackage(name, component);
      if (!pkg) return null;

      var mainjs = path.join(pkg, 'lib/main.js');
      if (!fs.existsSync(mainjs)) return null;

      return requirePackage(pkg, mainjs);
    }

    /**
     * Returns package path (packages/component-name/).
     *
     * @param {String} name Component name.
     * @param {Array|String} component Item from bower.commands.list(kind: list).
     * @return {String}
     */
    function findPackage(name, component) {
      var packages = expandForAll(component, joinPathWith(null, 'packages/*'));

      if (packages.length === 0) {
        // No packages found
        return null;
      }
      else if (packages.length === 1) {
        // Only one package: return it
        return packages[0];
      }
      else {
        // More than one package: try to guess
        return guessBestFile(name, packages);
      }
    }

    /**
     * Returns concatenated package source code.
     * Expands all `require()`s.
     *
     * @param {String} pkg Package path.
     * @param {String} mainjs Main JS file path.
     * @return {String}
     */
    function requirePackage(pkg, mainjs) {
      var processed = {};
      var pkgName = path.basename(pkg);
      var code = grunt.file.read(mainjs);
      while (true) {
        var requires = detective(code);
        if (!requires.length) break;
        for (var requireIdx in requires) {
          var name = requires[requireIdx];
          var requiredCode = '';
          if (!processed[name]) {
            var filepath = path.join(pkg, 'lib', name.replace(pkgName + '/', '') + '.js');
            requiredCode = grunt.file.read(filepath);
            processed[name] = true;
          }
          code = code.replace(new RegExp('require\\([\\\'\"]' + name + '[\\\'\"]\\);?'), requiredCode);
        }
      }
      return code;
    }

    /**
     * Resolves a graph of dependencies into a flat, ordered array.
     *
     * The arrays ordering ensures, that a dependecy of another module comes before the module itself.
     *
     * This algorithem is adapted from the pseudo code example available here:
     * http://www.electricmonk.nl/log/2008/08/07/dependency-resolving-algorithm/
     */
    function resolveDependencyGraph(module, resolved, unresolved, dependencies) {
      var moduleDependencies;
      if (module) {
        moduleDependencies = dependencies[module];
        if (!moduleDependencies) {
          throw new Error('Component ' + module + ' not installed. Try bower install --save ' + module);
        }
        unresolved.push(module);
      }
      else {
        moduleDependencies = Object.keys(dependencies);
      }

      moduleDependencies.forEach(function(moduleDependency) {
        if (resolved.indexOf(moduleDependency) === -1) {
          if (unresolved.indexOf(moduleDependency) !== -1) {
            throw new Error('Circular reference detected for ' + module + ' - ' + moduleDependency);
          }

          resolveDependencyGraph(moduleDependency, resolved, unresolved, dependencies);
        }
      });

      if (module) {
        resolved.push(module);
        unresolved = unresolved.splice(unresolved.indexOf(module), 1);
      }
    }

    /**
     * Runs grunt.file.expand for every array item and returns combined array.
     *
     * @param {Array|String} array Masks (can be single string mask).
     * @param {Function} makeMask function(mask) { return mask; }
     * @return {Array} All found files.
     */
    function expandForAll(array, makeMask) {
      var files = [];
      ensureArray(array).forEach(function(item) {
        files = files.concat(grunt.file.expand(makeMask(item)));
      });
      return files;
    }

    /**
     * Computing Levenshtein distance to guess a main file.
     * Based on https://github.com/curist/grunt-bower
     *
     * @param {String} componentName Component name.
     * @param {Array} files List of all possible main files.
     * @return {String}
     */
    function guessBestFile(componentName, files) {
      var minDist = 1e13;
      var minDistIndex = -1;

      files.sort(function(a, b) {
        // Reverse order by path length
        return b.length - a.length;
      });

      files.forEach(function(filepath, i) {
        var filename = path.basename(filepath, '.js');
        var dist = _.str.levenshtein(componentName, filename);
        if (dist <= minDist) {
          minDist = dist;
          minDistIndex = i;
        }
      });

      if (minDistIndex !== -1) {
        return files[minDistIndex];
      }
      else {
        return undefined;
      }
    }

    function createJSTemplate(destination, files){
      var src = _.map(files, function(file){
        file = file.split(libDir.cwd).join('');
        return "<script src=\"{{ asset('" + file +"') }}\"></script>\n";
      });
      src.push('<!---');
      grunt.file.write(destination.path.destTemplate + '/' + destination.path.name + '.start.twig', src.join(''));
      grunt.file.write(destination.path.destTemplate + '/' + destination.path.name + '.end.twig', ' -->');

      grunt.log.writeln('Files ' + destination.path.name + '.start.twig and ' + destination.path.name + '.end.twig was created. Wrap compiled file by this templates. e.g if compiled file is lib.js\n put in your layout.twig:\n' +
      ' {% include :: ' + destination.path.name + '.start.twig'
      + ' ignore missing %} <script src="{{ asset(\'scripts/lib.js\') }}"></script> '
      + ' {% include :: ' + destination.path.name + '.end.twig' + ' ignore missing %}');
    }

    function createCSSTemplate(destination, files){
      var src = _.map(files, function(file){
        file = file.split(libDir.cwd).join('');
        return "<link rel=\"stylesheet\" media=\"all\" href=\"{{ asset('" + file +"') }}\">\n";
      });
      src.push('<!---');
      grunt.file.write(destination.path.destTemplate + '/' + destination.path.name + '.start.twig', src.join(''));
      grunt.file.write(destination.path.destTemplate + '/' + destination.path.name + '.end.twig', ' -->');

      grunt.log.writeln('Files ' + destination.path.name + '.start.twig and ' + destination.path.name + '.end.twig was created. Wrap compiled file by this templates. e.g if compiled file is lib.css\n put in your layout.twig:\n' +
      ' {% include :: ' + destination.path.name + '.start.twig'
      + ' ignore missing %} <script src="{{ asset(\'scripts/lib.css\') }}"></script> '
      + ' {% include :: ' + destination.path.name + '.end.twig' + ' ignore missing %}');
    }

  });

};
