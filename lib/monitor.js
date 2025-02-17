'use strict';


const util = require('util');
const EventEmitter = require('events').EventEmitter;
const httpMonitor = require('./http');
const tcpMonitor = require('./tcp');
const utils = require('./utils');
const crypto = require('crypto');




function Monitor (opts = {}, state = {}) {
  EventEmitter.call(this);

  this.id = null;

  this.created_at = null;
  this.started_at = null;
  this.title = '';

  this.method = 'GET';

  this.website = null;

  this.address =  null;

  this.interval = 5;

  this.port = null;

  this.handle = null;

  this.isUp =  true;

  this.paused = false;

  this.totalRequests = 0;

  this.totalDownTimes = 0;

  this.lastDownTime = null;

  this.lastRequest = null;
  this.isLasteCheckWasDown = false;
  this.ignoreSSL = false;

  this.automaticStart = false;

  this.httpOptions = {};
  //assert
  this.expect = {
    statusCode: 200,
    contentSearch: null
  };

  this.config = {
    intervalUnits: 'minutes',
    generateId: true
  };
  //this variable is ued to check if first request failed to initial [downtime] with the data
  this.isFirstRequest = true;
  //Report values
  //current status of the URL
  this.status = '';
  //The total number of URL downtimes
  this.outages  = 0;
  // The total time, in seconds, of the URL downtime.
  this.downtime = 0;
  //the average response time for the URL
  this.responseTime = 0;
  //Timestamped logs of the polling requests
  this.history = [];
  // initialize the app
  this.init(opts, state);
}




// Inherit from EventEmitter
util.inherits(Monitor, EventEmitter);




Monitor.prototype.init = function (opts, state) {
  const currentState = this.mergeState(opts, state);

  if (currentState.config.generateId) {
    currentState.id = crypto.randomBytes(16).toString('hex');
  }

  if (currentState.website && currentState.address) {
    const msg = 'You can only specify either a website or ip address';

    return this.emit('error', new Error(msg));
  }

  if (!currentState.created_at) {
    currentState.created_at = Date.now();
  }
  
  if (currentState.ignoreSSL) {
    currentState.httpOptions.checkServerIdentity = () => false;
  }

  this.setState(currentState);
  if(this.automaticStart){
    if (this.website) {
      this.start('http');
    }
    else {
      this.start('tcp');
    }
  }
};




Monitor.prototype.setState = function (state) {
  Object.keys(state).forEach((key) => {
    if (this.hasOwnProperty(key)) {
      this[key] = state[key];
    }
  });
};




Monitor.prototype.mergeState = function (opts = {}, state = {}) {
  const currentState = this.getState();
  const innnerObjects = {};
  const params = [...arguments];

  params.forEach((param) => {
    if (opts.config) {
      innnerObjects.config = Object.assign(currentState.config, param.config); 
    }
    if (param.httpOptions) {
      innnerObjects.httpOptions = Object.assign(currentState.httpOptions, param.httpOptions);
    }
    if (param.expect) {
      innnerObjects.config = Object.assign(currentState.config, param.expect);
    }
  });

  return Object.assign(currentState, opts, state, innnerObjects);
};

Monitor.prototype.getReport = function () {
  return {

    totalRequests: this.totalRequests,
    totalDownTimes: this.totalDownTimes,
    lastDownTime: (this.lastDownTime) ? new Date(this.lastDownTime).toString() : null ,
    lastRequest: new Date(this.lastRequest).toString(),
    status:this.status ,
    outages:this.outages  ,
    downtime:this.downtime /1000 +"s" ,
    //A percentage of the URL availability
    //100- (downtime/totalTime)*100
    availability:100- ((this.outages/this.totalRequests)*100) +'%' ,
    // The total time, in seconds, of the URL uptime
    //(The DateTime now - The Start time of monitor) - total time in seconds of downtime
    uptime: Math.floor(((Date.now() - this.started_at) - this.downtime) / 1000) +"s" ,
    responseTime:this.responseTime+"s" ,
    history:this.history ,
  };
};

Monitor.prototype.getState = function () {
  return {
    id: this.id,
    title: this.title,
    created_at: this.created_at,
    isUp:  this.isUp,
    website: this.website,
    address: this.address,
    port: this.port,
    totalRequests: this.totalRequests,
    totalDownTimes: this.totalDownTimes,
    lastDownTime: this.lastDownTime,
    lastRequest: this.lastRequest,
    interval: this.interval,
    paused: this.paused,
    httpOptions: this.httpOptions,
    method: this.method,
    ignoreSSL: this.ignoreSSL,
    expect: this.expect,
    config: this.config
  };
};




Monitor.prototype.start = function (protocol) {
  const host = this.website || this.address;
  const startTime = utils.getFormatedDate();

  const INTERVAL = utils.intervalUnits(this.interval, this.config.intervalUnits);

  /*eslint no-console: ["error", { allow: ["warn", "error", "log"] }] */
  console.log(`\nMonitoring: ${host}\nTime: ${startTime}\n`);
  this.started_at = Date.now();
  if (protocol === 'http') {
    this.pingHTTP();

    // create an interval for pings
    this.handle = setInterval(() => {
      this.pingHTTP();
    }, INTERVAL);
  }
  else {
    this.pingTCP();

    // create an interval for pings
    this.handle = setInterval(() => {
      this.pingTCP();
    }, INTERVAL);
  }
};


Monitor.prototype.stop = function () {
  let responseData = utils.responseData(
    200, 
    this.website, 
    0, 
    this.address, 
    this.port
  );

  this.clearInterval();

  this.emit('stop', responseData, this.getState());

  return this;
};


Monitor.prototype.pause = function () {
  if (this.handle) {
    this.clearInterval();
  }

  this.paused = true;

  /*eslint no-console: ["error", { allow: ["warn", "error", "log"] }] */
  console.log('%s has paused', this.title || this.website || this.address);

  return this;
};




Monitor.prototype.resume = function () {
  this.paused = false;

  if (this.website) {
    this.start('http');
  }
  else if (this.address) {
    this.start('tcp');
  }

  /*eslint no-console: ["error", { allow: ["warn", "error", "log"] }] */
  console.log('%s has resumed', this.title || this.website || this.address);
};


Monitor.prototype.unpause = Monitor.prototype.resume;




Monitor.prototype.restart = function () {
  
  this.stop();

  if (this.website) {
    this.start('http');
  }
  else {
    this.start('tcp');
  }

  return this;
};


Monitor.prototype.clearInterval = function () {
  clearInterval(this.handle);
  this.handle = null;
};


Monitor.prototype.pingHTTP = function () {
  this.totalRequests += 1;
  this.lastRequest = Date.now();
  this.history.push(Date.now());
  const options = {
    website: this.website,
    address: this.website,
    method: this.method,
    httpOptions: this.httpOptions
  };

  const handleResponse = (error, data, res) => {
    if(!error) {
      let bodyChunks = [];

      res.on('data', (chunk) => {
        bodyChunks.push(chunk);
      });

      res.on('end', () => {
        data.body = bodyChunks.join('');
        
        if (this.expect) {
          
          let isUp = true;
  
          // Check if actual status code matches the expected code.
          if (this.expect.statusCode) {
            isUp = isUp && (parseInt(res.statusCode , 10) === parseInt(this.expect.statusCode, 10));
          }
  
          // Checks if we can find the content within the response body.
          if (this.expect.contentSearch) {
            isUp = isUp && data.body.includes(this.expect.contentSearch);
          }
          
          
          if (isUp) {
            this.up();
          }
          else {
            this.down();
          }
        }
        else if (res.statusCode == 200) {
          this.up();
        }
        else {
          this.down();
        }
  
        this.respond(res.statusCode, data, error);
      });
    } 
    else {
      this.down();

      this.respond(res.statusCode, data, error);
    }
  };

  process.nextTick(() => httpMonitor(options, handleResponse));
};


Monitor.prototype.pingTCP = function () {
  this.totalRequests += 1;
  this.lastRequest = Date.now();
  this.history.push(Date.now());

  const handleResponse = (error, data) => {
    if (error) {
      this.down();
      this.respond(500, data, error);
    }
    else {
      this.up();
      this.respond(200, data);
    }
  };

  process.nextTick(() => {
    tcpMonitor({
      address: this.address,
      port: this.port || 0
    }, handleResponse);
  });
};


Monitor.prototype.respond = function (statusCode, data, error) {
  let responseData = utils.responseData(statusCode, this.website, data.responseTime, this.address, this.port);

  //Report Data
  this.status = statusCode;
  this.responseTime = (this.responseTime + data.responseTime)/ this.totalRequests;
  if (data.httpResponse) {
    responseData.httpResponse = data.httpResponse;
  }

  if (this.isUp) {
    this.emit('up', responseData, this.getState());
  }
  else {
    if (data.timeout) {
      this.emit('timeout', error, responseData, this.getState());
    }
    else if (error) {
      this.emit('error', error, responseData, this.getState());
    }
    else {
      this.emit('down', responseData, this.getState());
    }
  }
};




Monitor.prototype.down = function () {
  this.isUp = false;
  this.totalDownTimes += 1;
  this.outages += 1 ;
  if(this.isLasteCheckWasDown){
    this.downtime += Date.now() - this.lastDownTime;
  }else {
    this.isLasteCheckWasDown = true;
  }
  this.lastDownTime = Date.now();
  if(this.isFirstRequest){
    this.downtime += Date.now() - this.started_at
    this.isFirstRequest = false;
  }
};

Monitor.prototype.up = function () {
  this.isUp = true;
  if(this.isLasteCheckWasDown){
    this.downtime += Date.now() - this.lastDownTime;
  }
  this.isLasteCheckWasDown = false;
  if(this.isFirstRequest){
    this.isFirstRequest = false;
  }
};

module.exports = Monitor;
