/**
 * Created by shaynegui on 2015/6/23.
 */
var cmdUtil = require("cmd-util")
var gulp = require("gulp")
var replace = require("gulp-replace")

function getDependencies() {

}

gulp.task("replaceDependencies", function(done) {
  gulp.src("./example/demo.html")
    .pipe(replace(/CMD_MANIFEST\(\[(["'].*["'])*?\]\)/g, getDependencies))
})
