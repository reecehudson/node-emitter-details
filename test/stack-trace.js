"use strict";

// imports
var getCallSite = require("../lib/trace.js").getCallSite;
var assert = require("assert");
var getStackTrace = require("../lib/trace.js").getStackTrace;
var path = require("path");

// a few props that identify a call site obj
var callSiteProps = [
  "getThis",
  "getTypeName",
  "getFunction",
  "getFunctionName",
  "getLineNumber"
], cs;

function a() {
  b()
  function b() {
    c()
    function c() {
      d()
      function d() {
        cs = getCallSite (null, 0);
      }
    }
  }
}

a();
// assert that it's a call site object
callSiteProps.forEach(function (name) {
  assert.strictEqual(true, name in cs);
}, null);

if (!(process.env.CI === "true" && process.env.TRAVIS === "true")) tester2();

// getStackTrace(), only comparing part of it as home dirs differ per platform
function tester2() {
  var s1, s2, s3, tstr, tlen;

  s1 = "    at tester2 ";
  s2 = "(" +  __dirname;
  // NOTE we do not include 'test/' because that *should be* the CD as is
  // changed by test.bat
  s3 = path.sep + "stack-trace.js";
  tstr = s1 + s2 + s3;
  tlen = tstr.length;
  // include this IIFE in stack trace
  assert.equal(getStackTrace(null).slice(0, tlen), tstr);
}
