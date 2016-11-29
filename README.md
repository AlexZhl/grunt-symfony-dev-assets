# grunt-symfony-dev-assets

If you use bower and bower_concat. In dev env you're probably want use not concatenated and minified version libs

So we generate twig templates which contain all bower libs and css as asset and comment minified prod version.

e.g
{# this typical js block which contain js assets

{% twig %}

  {% javascript %}
      {# in this template list of libs assets; also it start regular html comment #}
      {% include 'js-dev-template.start.twig' ignore missing %}
        {# this is contactenated file; it will be loaded only if templates dont exist #}
          <script src="{{ asset('scripts/lib.js') }}"></script>
          {# you able to add some other scripts which will commented in dev env #}
      {# in this template end of regular html comment #}
      {% include 'js-dev-template.end.twig' ignore missing %}


{% endblock %}


## Getting Started
This plugin requires Grunt `~0.4.5`

If you haven't used [Grunt](http://gruntjs.com/) before, be sure to check out the [Getting Started](http://gruntjs.com/getting-started) guide, as it explains how to create a [Gruntfile](http://gruntjs.com/sample-gruntfile) as well as install and use Grunt plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install grunt-symfony-dev-assets --save-dev
```

Once the plugin has been installed, it may be enabled inside your Gruntfile with this line of JavaScript:

```js
grunt.loadNpmTasks('grunt-symfony-dev-assets');
```

## The "symfony_dev_assets" task

### Overview
In your project's Gruntfile, add a section named `symfony_dev_assets` to the data object passed into `grunt.initConfig()`.

```js
grunt.initConfig({
      symfony_dev_assets: {
        build: {
          js: {
            name: 'js-dev-template',
            destTemplate: '<%= config.templates %>',
            mainFiles: {
              'bootstrap': ['dist/js/bootstrap.js'],
              'slick-carousel': ['slick/slick.js']
            }
          },
          css: {
            name: 'css-dev-template',
            destTemplate: '<%= config.templates %>',
            mainFiles: {
              'bootstrap': ['dist/css/bootstrap.css']
            },
            additionalFiles: ['<%= config.dist %>/styles/main.css']
          },
          libDir:
          {
            cwd : '<%= config.dist %>/',
            dir : 'libs/'
          }
        }
      }
});
```

### Usage Examples
 TODO
 
 tip. add two grunt task e.g build and dist like that:
 
 grunt.registerTask('build', [
     'clean:dist', clean directories see grunt-contrib-clean
     'clean:templates',  clean directories see grunt-contrib-clean
     'bower',
     'copy:copyBowerLibs', // copy libraries in directory see grunt-contrib-copy
     'symfony_dev_assets',
   ]);
 
 
   grunt.registerTask('dist', [
     'clean:dist',
     'clean:templates',
     'bower:dist',
     'bower_concat',
     'postcss',
     'cssmin'
   ]);
 };
 
 in first task we are get dev env in second one prod.
#### Default Options
TODO
## Release History
_(Nothing yet)_
