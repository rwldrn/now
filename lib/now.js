var nowLib = {};
var now = {};
var nowReadyFuncs = [];

var SERVER_ID = 'server';
var isIE = nowUtil.isLegacyIE();
var socket;

now.ready = function(func) {
  // Instead of using events, we'll just add it to an array of functions that needs to be called
  if(arguments.length == 0) {
    for(var i in nowReadyFuncs) {
      if(nowReadyFuncs.hasOwnProperty(i)) {
        nowReadyFuncs[i]();
      }
    }
  } else {
    nowReadyFuncs.push(func); 
  }
  
}


var dependencies = ["/socket.io/socket.io.js"];
var dependenciesLoaded = 0;

var nowJSScriptLoaded = function(){

  dependenciesLoaded++;
  if(dependenciesLoaded < dependencies.length) return;
    
  nowUtil.debug("isIE", isIE);
 

  socket = new io.Socket('**SERVER**', {port: **PORT**}); 
  socket.connect();
  socket.on('connect', function(){ 
    
    var client = socket;
    client.sessionId = SERVER_ID;
    nowLib.handleNewConnection(client);
  });
}

nowLib.nowJSReady = function(){  

  // client initialized
  var nowOld = now;
  
  now = nowCore.scopes[SERVER_ID];
  
  var ready = nowOld.ready;
  
  delete nowOld.ready;
  nowUtil.initializeScope(nowOld, socket);
  
  
  nowUtil.addChildrenToBlacklist(nowCore.watchersBlacklist[SERVER_ID], nowOld, "now");
  
  
  for(var key in nowOld) {
    now[key] = nowOld[key];
  }
 
  setTimeout(function(){
    nowCore.watchers[SERVER_ID].processScope();
  }, 1000);

  
  // Call the ready handlers
  ready();
}


nowLib.NowWatcher = function(fqnRoot, scopeObj, scopeClone, variableChanged) {
  this.data = {watchedKeys: {}, hashedArrays: {}};
  
  this.traverseObject = function(path, obj, arrayBlacklist, objClone) {
    // Prevent new array items from being double counted
    for(var key in obj){
      if(obj.hasOwnProperty(key)){
        var fqn = path+"."+key;
        
        // Ignore ready function
        if(fqn == 'now.ready') {
          continue;
        }
        
        if(isIE && !nowUtil.isArray(obj) && objClone.hasOwnProperty(key) && obj[key] != objClone[key]) {
          this.variableChanged(key, fqn, obj[key], objClone[key]);
          objClone[key] = obj[key];
        }
        if(!this.data.watchedKeys.hasOwnProperty(fqn)) {
          if(!isIE){
            nowUtil.watch(obj, key, fqn, this.variableChanged);
          } else {
            objClone[key] = obj[key];
          }
          if(!arrayBlacklist.hasOwnProperty(fqn)) {
            this.variableChanged(key, fqn, "", obj[key]);
          }
          this.data.watchedKeys[fqn] = true;
        }
        
        if(typeof obj[key] == 'object') {
          if(nowUtil.isArray(obj[key])) {
            if(this.data.hashedArrays.hasOwnProperty(fqn)){
              var diff = this.compareArray(this.data.hashedArrays[fqn], obj[key]);
              if(diff === false) {
                // Replace the whole array
                this.variableChanged(key, fqn, this.data.hashedArrays[fqn], []);
              } else if(diff !== true) {
                for(var i in diff) {
                  if(diff.hasOwnProperty(i)){
                    arrayBlacklist[fqn+"."+i] = true;
                    this.variableChanged(i, fqn+"."+i, this.data.hashedArrays[fqn][i], diff[i]);
                  }
                }  
              }
            }
            this.data.hashedArrays[fqn] = obj[key].slice(0); 
          }
          if(isIE && !objClone.hasOwnProperty(key)) {
            if(nowUtil.isArray(obj[key])) {
              objClone[key] = [];
            } else {
              objClone[key] = {};
            }
          }
          this.traverseObject(fqn, obj[key], arrayBlacklist, objClone[key]);
        }
      }
    }
  }

  this.processScope = function(){
    if(isIE) {
      this.traverseObject(fqnRoot, scopeObj, {}, scopeClone);
    } else {
      this.traverseObject(fqnRoot, scopeObj, {});
    }
    setTimeout(function(){
      nowCore.watchers[SERVER_ID].processScope();
    }, 1000);
  }

  this.variableChanged = variableChanged;

   /** 
   * Returns true if two the two arrays are identical. 
   * Returns an object of differences if keys have been added or the value at a key has changed
   * Returns false if keys have been deleted
   */
  this.compareArray = function(oldArr, newArr) {
    var result = {};
    var modified = false;
    if(newArr.length >= oldArr.length) {
      for(var i in newArr) {
        if(!oldArr.hasOwnProperty(i) || newArr[i] !== oldArr[i]) {
          result[i] = newArr[i];
          modified = true;
        }
      }
      return (modified) ? result : true;
    } else {
      return false;
    }
  }
}


nowLib.handleNewConnection = function(client){

  client.on('message', function(message){
    var messageObj = message;
    if(messageObj != null && messageObj.hasOwnProperty("type") && nowCore.messageHandlers.hasOwnProperty(messageObj.type)) {
        nowCore.messageHandlers[messageObj.type](client, messageObj.data);
    }
  });
  
  client.on('disconnect', function(){
    nowCore.handleDisconnection(client);  
  });
}




var nowCore = {};
nowCore.scopes = {};
nowCore.watchers = {};
nowCore.watchersBlacklist = {};
nowCore.callbacks = {};
nowCore.messageHandlers = {};
nowCore.closures = {};

nowLib.nowCore = nowCore;

/* ===== BEGIN MESSAGE HANDLERS ===== */
nowCore.messageHandlers.remoteCall = function(client, data){
  nowUtil.debug("handleRemoteCall", data.callId)
  var clientScope = nowCore.scopes[client.sessionId];
  
  var theFunction;
  if(data.functionName.split('_')[0] == 'closure'){
    theFunction = nowCore.closures[data.functionName];
  } else {
    theFunction = nowUtil.getVarFromFqn(data.functionName, clientScope);
  }
  
  var theArgs = data.arguments;
  
  for(var i in theArgs){
    if(theArgs[i].hasOwnProperty('type') && theArgs[i].type == 'function'){
      theArgs[i] = nowCore.constructRemoteFunction(client, theArgs[i].fqn);
    }
  }
  
  var callId = data.callId;
  var response = {type:"callReturn", data: {callId: callId}};
  theFunction.apply({now: clientScope, clientId: client.sessionId}, theArgs);
 
  nowUtil.debug("handleRemoteCall" , "completed " + callId);
}


nowCore.messageHandlers.createScope = function(client, data){
  nowCore.watchersBlacklist[client.sessionId] = {};
  var scope = nowUtil.retrocycle(data.scope, nowCore.constructHandleFunctionForClientScope(client));
  
  nowUtil.debug("handleCreateScope", "");
  nowUtil.print(scope);
  
  // Blacklist the entire scope so it is not sent back to the client
  nowUtil.addChildrenToBlacklist(nowCore.watchersBlacklist[client.sessionId], scope, "now");
  
  nowCore.watchers[client.sessionId] = new nowLib.NowWatcher("now", scope, {}, function(prop, fqn, oldVal, newVal){
    if(!nowCore.watchersBlacklist[client.sessionId].hasOwnProperty(fqn)){
      nowUtil.debug("clientScopeWatcherVariableChanged", fqn + " => " + newVal);
      if(typeof oldVal == "object") {
        var oldFqns = nowUtil.getAllChildFqns(oldVal, fqn);
        
        for(var i in oldFqns) {
          delete nowCore.watchers[client.sessionId].data.watchedKeys[oldFqns[i]];  
        }
      }
      
      
      nowUtil.addChildrenToBlacklist(nowCore.watchersBlacklist[client.sessionId], newVal, fqn);
      
      var key = fqn.split(".")[1];
      var data = nowUtil.decycle(scope[key], key, [nowUtil.serializeFunction]);
      
      client.send({type: 'replaceVar', data: {key: key, value: data[0]}});    
    } else {
      nowUtil.debug("clientScopeWatcherVariableChanged", fqn + " change ignored");
      delete nowCore.watchersBlacklist[client.sessionId][fqn];
    }
    
    // In case the object is an array, we delete from hashedArrays to prevent multiple watcher firing
    delete nowCore.watchers[client.sessionId].data.hashedArrays[fqn];
    
  });
  nowCore.scopes[client.sessionId] = scope;
  nowLib.nowJSReady();
}


nowCore.constructHandleFunctionForClientScope = function(client) {
  return function(funcObj) {
    return nowCore.constructRemoteFunction(client, funcObj.fqn);
  }
}


nowCore.messageHandlers.replaceVar = function(client, data){

  nowUtil.debug("handleReplaceVar", data.key + " => " + data.value);
  
  var scope = nowCore.scopes[client.sessionId];
  
  
  var newVal = nowUtil.retrocycle(data.value, nowCore.constructHandleFunctionForClientScope(client));

  nowCore.watchersBlacklist[client.sessionId]["now."+data.key] = true;
  
  nowUtil.addChildrenToBlacklist(nowCore.watchersBlacklist[client.sessionId], newVal, "now."+data.key);
  
  for(var key in nowCore.watchers[client.sessionId].data.watchedKeys) {
    if(key.indexOf("now."+data.key+".") === 0) {
      delete nowCore.watchers[client.sessionId].data.watchedKeys[key];
    }
  }
    
  scope[data.key] = newVal;

}

/* ===== END MESSAGE HANDLERS ====== */

nowCore.handleDisconnection = function(client) {
  //Remove scope and callbacks
  setTimeout(function(){
    if(!client.connected) {
      delete nowCore.scopes[client.sessionId];
      delete nowCore.watchers[client.sessionId];
      delete nowCore.watchersBlacklist[client.sessionId];
      delete nowCore.closures[client.sessionId];
    }    
  }, 10000)
}


nowCore.constructRemoteFunction = function(client, functionName){
  
  nowUtil.debug("constructRemoteFunction", functionName);
    
  var remoteFn = function(){
    var callId = functionName+ "_"+ new Date().getTime();
    
    nowUtil.debug("executeRemoteFunction", functionName + ", " + callId);

    arguments = Array.prototype.slice.call(arguments);
    
    for(var i in arguments){
      if(typeof arguments[i] == 'function' && arguments.hasOwnProperty(i)){
        var closureId = "closure" + "_" + arguments[i].name + "_" + new Date().getTime();
        nowCore.closures[closureId] = arguments[i];
        arguments[i] = {type: 'function', fqn: closureId};
      }
    }

    client.send({type: 'remoteCall', data: {callId: callId, functionName: functionName, arguments: arguments}});
  }
  return remoteFn;
}


for(var i in dependencies){
  if(dependencies.hasOwnProperty(i)){
    var fileref=document.createElement('script');
    fileref.setAttribute("type","text/javascript");
    fileref.setAttribute("src", "http://**SERVER**:**PORT**"+dependencies[i]);
    fileref.onload = nowJSScriptLoaded;
    if(isIE) {
      fileref.onreadystatechange = function () {
        if(fileref.readyState == "loaded") {
          nowJSScriptLoaded();
        }
      }
    }
    document.getElementsByTagName("head")[0].appendChild(fileref);
  }
}
