"use strict";

var EE = require("events");
var util = require("util");
var assert = require("assert");
var EmitterDetails = require("./lib/emitter-details.js");
var EventDetails = require("./lib/event-details.js");
var HandlerDetails = require("./lib/handler-details.js");
var helpers = require("./lib/helpers.js");
var getCallSite = require("./lib/stack-trace.js");

/**
* @api public
* @param {EventEmitter} emitter
* @param {Object} opts
* @return {Object} emitterDetails
* Wraps the passed-in emitter, returning the stats object
*/
var exp = module.exports =
function getEmitterDetails(emitter, opts) {

  /* ----- filter args ----- */

  (function normalizeOpts() {
    var exEvs;

    opts = util.isObject(opts) ? opts : Object.create(null);
    exEvs = opts.excludedEvents;
    opts.excludedEvents = util.isArray(exEvs) ? exEvs : [];
    opts.saveInactiveEventDetails = !!opts.saveInactiveEventDetails;
  }())

  assert.ok(emitter instanceof EE, "arg must be an Event Emitter");

  /* ----- main body: update emitter details & add crucial handlers ----- */

  var emitterDetails = new EmitterDetails(emitter);
  var _events = helpers.copy(emitter._events);
  var xEvents = opts.excludedEvents;

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
      handlers = util.isArray(event) ? event : [event];
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

    if (~opts.excludedEvents.indexOf(event)) {
      return;
    }

    if (util.isNull(evDetails = emitterDetails.getEventDetails(event))) {
      evDetails = emitterDetails._addEvent(event, listener);
      // for @lib/event-details.js onUpdate()
      evDetails.genericEventRegulator = genericEventRegulator;
      evDetails.name = event;
      if (!(event === "newListener" || event === "removeListener"))
        EE.prototype.on.call(emitter, event, genericEventRegulator);
    } else {
      // TODO make sure genericEventRegulator is set i.e. debug(...)
      evDetails._addHandler(listener);
    }
    // make genericEventRegulator an emitter, this is for
    // async getEmissionCxt to listen on & maybe future add-ons
    var helper;
    // FIXME why __proto__ x2
    genericEventRegulator.__proto__.__proto__ = EE.prototype;
    function Helper() {
      EE.call(this);
    }
    Object.getOwnPropertyNames(helper = new Helper).forEach(function(prop) {
      genericEventRegulator[prop] = helper[prop];
    });
    helper = null;

    function genericEventRegulator() {
      var stackTrace, err = new Error,
          callSite = getCallSite(genericEventRegulator, 0);

      if (!~emitterDetails.emittedEvents.indexOf(event)) {
        emitterDetails.emittedEvents.push(event);
      }

      evDetails.timesEmitted++;
      evDetails.prevArgs = helpers.copy(arguments);
      // TODO use a method exposed by (new) lib/trace.js object
      // use the call site to get cxt
      // FIXME disabled for now until we figure it out
      // evDetails.calledCxt = callSite.getThis() || callSite.getTypeName();
      // capturing stack trace
      // TODO see previous todo
      Error.captureStackTrace(err, genericEventRegulator);
      stackTrace = err.stack.slice(6, err.stack.length);
      // update 'prevStackTrace' on all listeners
      evDetails.listeners.forEach(function (handler) {
        var hdlrDetails = handler[1];
        hdlrDetails.prevStackTrace = stackTrace;
      }, null);
      // after updating, emit itself and pass in eventDetails for async
      genericEventRegulator.emit(event, evDetails);
    }
  }

  function onRemoveListener(event, listener) {
    var evDetails = emitterDetails.getEventDetails(event);
    if (evDetails === null)
      return;

    evDetails._removeHandler(listener);
    if (emitter.listeners(event).length === 1 && emitter.listeners(event)[0].name === "genericEventRegulator") {
      // NOTE: we want `emitter.removeListener(event, genericEventRegulator)`
      // but genericEventRegulator is out of scope so...
      emitter.removeAllListeners(event);
      if (!opts.saveInactiveEventDetails) {
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
  var NOP = Object.getPrototypeOf(Function);

  EE.prototype.on.call(emitter, event, NOP);
  return exp(emitter).getEventDetails(event);
};
