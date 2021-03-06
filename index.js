"use strict";

var EE = require("events");
var util = require("util");
var assert = require("assert");
var EmitterDetails = require("./lib/emitter-details.js");
var EventDetails = require("./lib/event-details.js");
var HandlerDetails = require("./lib/handler-details.js");
var helpers = require("./lib/helpers.js");
var getCallSite = require("./lib/trace.js").getCallSite;
var getStackTrace = require("./lib/trace.js").getStackTrace;
var charge = require("ch-arge");

/**
* @api public
* @param {EventEmitter} emitter
* @param {Object} [opts]
* @return {Object} emitterDetails
* Wraps the passed-in emitter, returning the stats object
*/
var exp = module.exports =
function getEmitterDetails(emitter, opts) {

  /* ----- filter args ----- */
  charge(emitter, EE, {message: "arg 1 must be an event emitter"});
  charge(opts, "obj undefined", {message: "arg 2 must be an opts object or undefined"});
  emitterDetails = new EmitterDetails(emitter);
  (function normalizeOpts(that) {
    var exEvs, exHds;

    opts = typeof opts === "object" && opts !== null ?
            opts :
            Object.create(null);
    exEvs = opts.excludeEvents;
    exHds = opts.excludeHandlers;
    opts.excludeEvents = Array.isArray(exEvs) ? exEvs : [];
    opts.excludeHandlers = Array.isArray(exHds) ? exHds : [];
    opts.saveInactiveEventDetails = !!opts.saveInactiveEventDetails;
    that.opts = opts;
  }(emitterDetails))

  assert.ok(emitter instanceof EE, "arg must be an Event Emitter");

  /* ----- main body: update emitter details & add crucial handlers ----- */

  var emitterDetails;
  var _events = helpers.copy(emitter._events);
  var xEvents = emitterDetails.opts.excludeEvents;

  // special-case handlers are added now
  [["newListener", onNewListener], ["removeListener", onRemoveListener]].forEach(function(pair) {
    if (!~xEvents.indexOf(pair[0])) {
      onNewListener(pair[0], pair[1]);
    }
  });

  // user-defined events are added now
  Object.keys(_events).forEach(function(name) {
    var handlers, event;
    if (!~xEvents.indexOf(name)) {
      event = _events[name];
      handlers = Array.isArray(event) ? event : [event];
      handlers.forEach(function(fn) {
        onNewListener(name, fn);
      }, null);
    }
  }, null);
  // release mem on next gc round
  _events = null;

  // NOTE must go in this order so `onRemoveListener` does not re-register
  emitter.on("removeListener", onRemoveListener);
  emitter.on("newListener", onNewListener);


  /* ----- return ----- */

  return emitterDetails;

  /* ----- func decls ----- */

  function onNewListener(event, listener) {
    var evDetails;

    if (
        ~emitterDetails.opts.excludeEvents.indexOf(event) ||
        ~emitterDetails.opts.excludeHandlers.indexOf(listener)
      ) {
      return;
    }

    if (null === (evDetails = emitterDetails.getEventDetails(event))) {
      evDetails = emitterDetails._addEvent(event, listener);
      // used in lib/event-details.js onUpdate()
      evDetails._onUpdate = _onUpdate;
      evDetails.name = event;
      if (!(event === "newListener" || event === "removeListener"))
        EE.prototype.on.call(emitter, event, _onUpdate);
    } else {
      evDetails._addHandler(listener);
    }

    var helper;
    // FIXME why __proto__ x2
    _onUpdate.__proto__.__proto__ = EE.prototype;
    function Helper() {
      EE.call(this);
    }
    Object.getOwnPropertyNames(helper = new Helper).forEach(function(prop) {
      _onUpdate[prop] = helper[prop];
    });
    helper = null;

    function _onUpdate() {
      var stackTrace, err = new Error,
          callSite = getCallSite(_onUpdate, 0);

      if (!~emitterDetails.emittedEvents.indexOf(event)) {
        emitterDetails.emittedEvents.push(event);
      }

      evDetails.timesEmitted++;
      evDetails.prevArgs = helpers.copy(arguments);
      stackTrace = getStackTrace(_onUpdate);
      // update 'prevStackTrace' on all listeners
      evDetails.listeners.forEach(function (handler) {
        var hdlrDetails = handler[1];
        hdlrDetails.prevStackTrace = stackTrace;
      }, null);
      // after updating, emit itself and pass in eventDetails for async
      _onUpdate.emit(event, evDetails);
    }
  }

  function onRemoveListener(event, listener) {
    var evDetails = emitterDetails.getEventDetails(event);
    if (evDetails === null)
      return;

    evDetails._removeHandler(listener);
    if (emitter.listeners(event).length === 1 && emitter.listeners(event)[0].name === "_onUpdate") {
      // NOTE: we want `emitter.removeListener(event, _onUpdate)`
      // but _onUpdate is out of scope so...
      emitter.removeAllListeners(event);
      if (!emitterDetails.opts.saveInactiveEventDetails) {
        delete emitterDetails.events[event];
      }
    }
  }
}

/**
* @api public
* @param {EventEmitter} emitter
* @param {String} event Event to track
* @return {Object} evDetails
*
* Creates an EmitterDetails obj.  Registers the event. Returns instance of
* EventDetails.  Intended use is when the listener for the event is irrelevant,
* i.e., we only want to *quickly-n-easily* spy on the event to get stats on it.
*/
exp.trackEvent = function (emitter, event) {
  charge(emitter, EE, {message: "arg 1 must be an event emitter"});
  charge(event, String, "arg 2 must be a string");
  var NOP = Object.getPrototypeOf(Function);

  EE.prototype.on.call(emitter, event, NOP);
  return exp(emitter).getEventDetails(event);
};
