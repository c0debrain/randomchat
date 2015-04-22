
syncninja.load('guest-randomchat', function (module, exports) {
    var app = require('syncninja/app');

    exports.addChat = function (syncObject, message, callback) {
        syncObject.at(['user-' + app.getSessionId()]).get(
            function (error, user) {
                if (error) {
                    callback(error);
                    return;
                }

                if (user.state !== 'room') {
                    callback(new Error("Invalid state."));
                    return;
                }
                var roomId = user.room;
                var name = user.name;
                syncObject
                    .at(['room-' + roomId, 'messages'])
                    .insertElement(null, name + ': ' + message);
            });
    };

    exports.userJoin = function (syncObject, name, callback) {
        if (typeof name !== 'string') {
            callback(new Error("Invalid args"));
            return;
        }
        var userDoc = syncObject.at(['user-' + app.getSessionId()]);
        userDoc.at(['state']).getExists(
            function (error, exists) {
                if (error) {
                    callback(error);
                    return;
                }

                var doJoin = function (error) {
                    if (error) {
                        callback(error);
                        return;
                    }

                    userDoc.at('name').create(name);
                    userDoc.at('state').create('waiting');

                    var waitingObj = syncObject.at(['lobby', 'waiting']);
                    waitingObj.touch(function () {});
                    waitingObj.get(
                        function (error, waiting) {
                            if (error || waiting === null) {
                                // Add self to lobby.
                                waitingObj.set(app.getSessionId());
                            } else {
                                // Found someone.
                                var otherSessionId = waiting;
                                _createRoom(
                                    syncObject, app.getSessionId(),
                                    otherSessionId, callback);
                                // Take that someone out of lobby.
                                waitingObj.set(null);
                            }
                        });
                };

                if (exists) {
                    exports.userDisconnect(syncObject, doJoin);
                } else {
                    doJoin(null);
                }
            });
    };

    exports.userDisconnect = function (syncObject, callback) {
        var userDoc = syncObject.at(['user-' + app.getSessionId()]);
        userDoc.at(['state']).get(
            function (error, state) {
                if (error) {
                    callback(null, null);
                    return;
                }

                if (state === 'waiting') {
                    var waitingObj = syncObject.at(['lobby', 'waiting']);
                    waitingObj.set(null);
                }

                userDoc.deleteProperty('name');
                userDoc.deleteProperty('state');
                userDoc.at(['room']).get(function (error, roomId) {
                    if (error || roomId === null) {
                        callback(null, null);
                        return;
                    }
                    _leaveRoom(
                        syncObject, roomId, app.getSessionId(), callback);
                });
            });
    };

    var _createRoom = function (syncObject, session1, session2, callback) {
        // Will run on server only, because docs not cached.
        var roomId = _randomId();
        var roomObj = syncObject.at(['room-' + roomId]);
        roomObj.at(['session1']).set(session1);
        roomObj.at(['session2']).set(session2);
        roomObj.at(['messages']).set(
            ["Connected! You are now chatting to a random person."]);
        roomObj.at(['oneLeft']).set(false);

        var user1Doc = syncObject.at(['user-' + session1]);
        user1Doc.at(['room']).set(roomId);
        user1Doc.at(['state']).set('room');
        var user2Doc = syncObject.at(['user-' + session2]);
        user2Doc.at(['room']).set(roomId);
        user2Doc.at(['state']).set('room');
    };

    var _leaveRoom = function (syncObject, roomId, sessionId, callback) {
        var roomObj = syncObject.at(['room-' + roomId]);
        roomObj.at('oneLeft').set(true);
        roomObj.at('messages').insertElement(null, "Disconnected!");
        var userDoc = syncObject.at(['user-' + sessionId]);
        userDoc.deleteProperty('room', callback);
    };

    var _alphabet = (
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    var _randomId = function () {
        var ret = [];
        for (var i = 0; i < 16; i++) {
            ret.push(
                _alphabet.charAt(Math.floor(Math.random() * _alphabet.length)));
        }
        return ret.join('');
    };
});

function initMessageInput() {
    var messageInput = document.getElementById('message-input');
    var messgeReturn = document.getElementById('message-return');
    var onAddMessage = function () {
        var message = messageInput.value;
        syncninja.run('addChat', message);
        messageInput.value = "";
    }
    if (messageInput) {
        messageInput.onkeyup = function (event) {
            if (event.keyCode == '13') {
                onAddMessage();
            }
        };
    }
    if (messgeReturn) {
        messgeReturn.onclick = function (event) {
            event.preventDefault();
            onAddMessage();
        };
    }
}

function getSessionId(callback) {
    var sessionId = syncninja.getSessionId();
    if (sessionId !== null) {
        callback(sessionId);
    } else {
        setTimeout(getSessionId.bind(null, callback), 100);
    }
}

var randomChat = angular.module('randomChat', ['syncninja']);

randomChat.controller(
    'MainController', function MainController($scope, $syncninja) {
        $scope.user = {};
        $scope.inRoom = false;
        $scope.nickname = 'Anonymous' + Math.floor(Math.random() * 1000);
        var prevRoom = null;
        getSessionId(function (sessionId) {
            $syncninja.$sync(
                ['user-' + sessionId], $scope.user, $scope,
                function () {
                    if ($scope.user.room !== prevRoom) {
                        prevRoom = $scope.user.room;

                        if ($scope.user.room) {
                            // Hack to restart RoomController.
                            $scope.inRoom = false;
                            setTimeout(function () {
                                $scope.inRoom = true;
                                $scope.$apply();
                            }, 100);
                        } else {
                            $scope.inRoom = false;
                        }
                    }
                });
        });
        $scope.findClick = function () {
            if ($scope.user.state === 'waiting') {
                return;
            }
            var nicknameBox = document.getElementById('nickname');
            if (nicknameBox) {
                var name = nicknameBox.value;
                if (name.trim() !== '') {
                    $scope.nickname = name;
                }
            }
            syncninja.run('userJoin', $scope.nickname);
        };
    });
randomChat.controller(
    'RoomController', function RoomController($scope, $syncninja) {
        initMessageInput();
        $scope.room = {};
        var otherConnected = false;
        $syncninja.$sync(
            ['room-' + $scope.user.room], $scope.room, $scope, function () {
                if ($scope.room.__subscribers.length === 2) {
                    otherConnected = true;
                } else if ($scope.room.__subscribers.length === 1) {
                    if (otherConnected) {
                        // Disconnected now. Disconnect ourselves then.
                        syncninja.run('userDisconnect');
                    }
                }
                var chatBox = document.getElementById('chat');
                if (chatBox) {
                    setTimeout(
                        function () {
                            chatBox.scrollTop = chat.scrollHeight;
                        }, 100);
                }
            });
    });
