(function (global, undefined) {

// Holds anything kiwi client specific (ie. front, gateway, _kiwi.plugs..)
/**
*   @namespace
*/
var _kiwi = {};

_kiwi.model = {};
_kiwi.view = {};
_kiwi.applets = {};


/**
 * A global container for third party access
 * Will be used to access a limited subset of kiwi functionality
 * and data (think: plugins)
 */
_kiwi.global = {
	settings: undefined,
	plugins: undefined,
	utils: undefined, // TODO: Re-usable methods
	user: undefined, // TODO: Limited user methods
	server: undefined, // TODO: Limited server methods

	// TODO: think of a better term for this as it will also refer to queries
	channels: undefined, // TODO: Limited access to panels list

	// Event managers for plugins
	components: {
	    EventComponent: function(event_source) {
	        function proxyEvent(event_name, event_data) {
	            this.trigger(event_name, event_data);
	        }

	        _.extend(this, Backbone.Events);

	        // Proxy the events to this dispatcher
	        event_source.on('all', proxyEvent, this);

	        // Clean up this object
	        this.dispose = function () {
	            event_source.off('all', proxyEvent);
	            this.off();
	        };
	    },

	    Network: function() {
	        var obj = new this.EventComponent(_kiwi.gateway);
	        var funcs = {
	        	kiwi: 'kiwi', raw: 'raw', kick: 'kick', topic: 'topic',
	        	part: 'part', join: 'join', action: 'action', ctcp: 'ctcp',
	        	notice: 'notice', msg: 'privmsg'
	        };

	        _.each(funcs, function(gateway_fn, func_name) {
	        	obj[func_name] = function() {
	        		var fn_name = gateway_fn;
	        		_kiwi.gateway[fn_name].apply(_kiwi.gateway, arguments);
	        	};
	        });

	        return obj;
	    },

	    ControlInput: function() {
	        var obj = new this.EventComponent(_kiwi.app.controlbox);
	        var funcs = {
	        	processInput: 'run'
	        };

	        _.each(funcs, function(controlbox_fn, func_name) {
	        	obj[func_name] = _kiwi.app.controlbox[controlbox_fn];
	        });

	        return obj;
	    }
	},

	// Entry point to start the kiwi application
	start: function (opts) {
		opts = opts || {};

        // Load the plugin manager
        _kiwi.global.plugins = new _kiwi.model.PluginManager();

        // Set up the settings datastore
        _kiwi.global.settings = _kiwi.model.DataStore.instance('kiwi.settings');
        _kiwi.global.settings.load();

		_kiwi.app = new _kiwi.model.Application(opts);

		if (opts.kiwi_server) {
			_kiwi.app.kiwi_server = opts.kiwi_server;
		}

		// Start the client up
		_kiwi.app.start();

		return true;
	}
};



// If within a closure, expose the kiwi globals
if (typeof global !== 'undefined') {
	global.kiwi = _kiwi.global;
} else {
	// Not within a closure so set a var in the current scope
	var kiwi = _kiwi.global;
}


_kiwi.model.Application = function () {
    // Set to a reference to this object within initialize()
    var that = null;

    // The auto connect details entered into the server select box
    var auto_connect_details = {};


    var model = function () {
        /** Instance of _kiwi.model.PanelList */
        this.panels = null;

        /** _kiwi.view.Application */
        this.view = null;

        /** _kiwi.view.StatusMessage */
        this.message = null;

        /* Address for the kiwi server */
        this.kiwi_server = null;

        this.initialize = function (options) {
            that = this;

            if (options[0].container) {
                this.set('container', options[0].container);
            }

            // The base url to the kiwi server
            this.set('base_path', options[0].base_path ? options[0].base_path : '/kiwi');

            // Any options sent down from the server
            this.server_settings = options[0].server_settings || {};

            // Best guess at where the kiwi server is
            this.detectKiwiServer();
        };

        this.start = function () {
            // Only debug if set in the querystring
            if (!getQueryVariable('debug')) {
                manageDebug(false);
            } else {
                //manageDebug(true);
            }
            
            // Set the gateway up
            _kiwi.gateway = new _kiwi.model.Gateway();
            this.bindGatewayCommands(_kiwi.gateway);

            this.initializeClient();
            this.initializeGlobals();

            this.view.barsHide(true);

            this.panels.server.server_login.bind('server_connect', function (event) {
                var server_login = this,
                    transport_path = '';
                auto_connect_details = event;

                server_login.networkConnecting();
                
                // Path to get the socket.io transport code
                transport_path = that.kiwi_server + that.get('base_path') + '/transport/socket.io.js?ts='+(new Date().getTime());
                
                $script(transport_path, function () {
                    if (!window.io) {
                        kiwiServerNotFound();
                        return;
                    }
                    _kiwi.gateway.set('kiwi_server', that.kiwi_server + '/kiwi');
                    _kiwi.gateway.set('nick', event.nick);
                    
                    _kiwi.gateway.connect(event.server, event.port, event.ssl, event.password, function (error) {
                        if (error) {
                            kiwiServerNotFound();
                        }
                    });
                });
            });

            // TODO: Shouldn't really be here but it's not working in the view.. :/
            // Hack for firefox browers: Focus is not given on this event loop iteration
            setTimeout(function(){
                _kiwi.app.panels.server.server_login.$el.find('.nick').select();
            }, 0);
        };


        function kiwiServerNotFound (e) {
            that.panels.server.server_login.showError();
        }


        this.detectKiwiServer = function () {
            // If running from file, default to localhost:7777 by default
            if (window.location.protocol === 'file:') {
                this.kiwi_server = 'http://localhost:7778';
            } else {
                // Assume the kiwi server is on the same server
                this.kiwi_server = window.location.protocol + '//' + window.location.host;
            }
        };


        this.initializeClient = function () {
            this.view = new _kiwi.view.Application({model: this, el: this.get('container')});
            
            /**
             * Set the UI components up
             */
            this.panels = new _kiwi.model.PanelList();

            this.controlbox = new _kiwi.view.ControlBox({el: $('#controlbox')[0]});
            this.bindControllboxCommands(this.controlbox);

            this.topicbar = new _kiwi.view.TopicBar({el: $('#topic')[0]});

            new _kiwi.view.AppToolbar({el: $('#toolbar .app_tools')[0]});

            this.message = new _kiwi.view.StatusMessage({el: $('#status_message')[0]});

            this.resize_handle = new _kiwi.view.ResizeHandler({el: $('#memberlists_resize_handle')[0]});
            
            this.panels.server.view.show();

            // Rejigg the UI sizes
            this.view.doLayout();

            this.populateDefaultServerSettings();
        };


        this.initializeGlobals = function () {
            _kiwi.global.panels = this.panels;
            
            _kiwi.global.components.Applet = _kiwi.model.Applet;
            _kiwi.global.components.Panel =_kiwi.model.Panel;
        };


        this.populateDefaultServerSettings = function () {
            var parts;
            var defaults = {
                nick: getQueryVariable('nick') || '',
                server: '',
                port: 6667,
                ssl: false,
                channel: window.location.hash || '#chat',
                channel_key: ''
            };
            var uricheck;


            /**
             * Get any settings set by the server
             * These settings may be changed in the server selection dialog
             */
            if (this.server_settings.client) {
                if (this.server_settings.client.nick)
                    defaults.nick = this.server_settings.client.nick;

                if (this.server_settings.client.server)
                    defaults.server = this.server_settings.client.server;

                if (this.server_settings.client.port)
                    defaults.port = this.server_settings.client.port;

                if (this.server_settings.client.ssl)
                    defaults.ssl = this.server_settings.client.ssl;

                if (this.server_settings.client.channel)
                    defaults.channel = this.server_settings.client.channel;
            }



            /**
             * Get any settings passed in the URL
             * These settings may be changed in the server selection dialog
             */

            // Process the URL part by part, extracting as we go
            parts = window.location.pathname.toString().replace(this.get('base_path'), '').split('/');

            if (parts.length > 0) {
                parts.shift();

                if (parts.length > 0 && parts[0]) {
                    // Check to see if we're dealing with an irc: uri, or whether we need to extract the server/channel info from the HTTP URL path.
                    uricheck = parts[0].substr(0, 7).toLowerCase();
                    if ((uricheck === 'ircs%3a') || (uricheck.substr(0,6) === 'irc%3a')) {
                        parts[0] = decodeURIComponent(parts[0]);
                        // irc[s]://<host>[:<port>]/[<channel>[?<password>]]
                        uricheck = /^irc(s)?:(?:\/\/?)?([^:\/]+)(?::([0-9]+))?(?:(?:\/)([^\?]*)(?:(?:\?)(.*))?)?$/.exec(parts[0]);
                        /*
                            uricheck[1] = ssl (optional)
                            uricheck[2] = host
                            uricheck[3] = port (optional)
                            uricheck[4] = channel (optional)
                            uricheck[5] = channel key (optional, channel must also be set)
                        */
                        if (uricheck) {
                            if (typeof uricheck[1] !== 'undefined') {
                                defaults.ssl = true;
                                if (defaults.port === 6667) {
                                    defaults.port = 6697;
                                }
                            }
                            defaults.server = uricheck[2];
                            if (typeof uricheck[3] !== 'undefined') {
                                defaults.port = uricheck[3];
                            }
                            if (typeof uricheck[4] !== 'undefined') {
                                defaults.channel = '#' + uricheck[4];
                                if (typeof uricheck[5] !== 'undefined') {
                                    defaults.channel_key = uricheck[5];
                                }
                            }
                        }
                        parts = [];
                    } else {
                        // Extract the port+ssl if we find one
                        if (parts[0].search(/:/) > 0) {
                            defaults.port = parts[0].substring(parts[0].search(/:/) + 1);
                            defaults.server = parts[0].substring(0, parts[0].search(/:/));
                            if (defaults.port[0] === '+') {
                                defaults.port = parseInt(defaults.port.substring(1), 10);
                                defaults.ssl = true;
                            } else {
                                defaults.ssl = false;
                            }

                        } else {
                            defaults.server = parts[0];
                        }

                        parts.shift();
                    }
                }

                if (parts.length > 0 && parts[0]) {
                    defaults.channel = '#' + parts[0];
                    parts.shift();
                }
            }

            // If any settings have been given by the server.. override any auto detected settings
            /**
             * Get any server restrictions as set in the server config
             * These settings can not be changed in the server selection dialog
             */
            if (this.server_settings && this.server_settings.connection) {
                if (this.server_settings.connection.server) {
                    defaults.server = this.server_settings.connection.server;
                }

                if (this.server_settings.connection.port) {
                    defaults.port = this.server_settings.connection.port;
                }

                if (this.server_settings.connection.ssl) {
                    defaults.ssl = this.server_settings.connection.ssl;
                }

                if (this.server_settings.connection.channel) {
                    defaults.channel = this.server_settings.connection.channel;
                }

                if (this.server_settings.connection.nick) {
                    defaults.nick = this.server_settings.connection.nick;
                }
            }

            // Set any random numbers if needed
            defaults.nick = defaults.nick.replace('?', Math.floor(Math.random() * 100000).toString());

            // Populate the server select box with defaults
            this.panels.server.server_login.populateFields(defaults);
        };


        this.bindGatewayCommands = function (gw) {
            gw.on('onmotd', function (event) {
                that.panels.server.addMsg(_kiwi.gateway.get('name'), event.msg, 'motd');
            });


            gw.on('onconnect', function (event) {
                that.view.barsShow();
                
                if (auto_connect_details.channel) {
                    that.controlbox.processInput('/JOIN ' + auto_connect_details.channel + ' ' + auto_connect_details.channel_key);
                }
            });


            (function () {
                var gw_stat = 0;

                gw.on('disconnect', function (event) {
                    var msg = 'You have been disconnected. Attempting to reconnect for you..';
                    that.message.text(msg, {timeout: 10000});

                    // Mention the disconnection on every channel
                    $.each(_kiwi.app.panels.models, function (idx, panel) {
                        if (!panel || !panel.isChannel()) return;
                        panel.addMsg('', msg, 'action quit');
                    });
                    _kiwi.app.panels.server.addMsg('', msg, 'action quit');

                    gw_stat = 1;
                });
                gw.on('reconnecting', function (event) {
                    msg = 'You have been disconnected. Attempting to reconnect again in ' + (event.delay/1000) + ' seconds..';
                    _kiwi.app.panels.server.addMsg('', msg, 'action quit');
                });
                gw.on('connect', function (event) {
                    if (gw_stat !== 1) return;

                    var msg = 'It\'s OK, you\'re connected again :)';
                    that.message.text(msg, {timeout: 5000});

                    // Mention the disconnection on every channel
                    $.each(_kiwi.app.panels.models, function (idx, panel) {
                        if (!panel || !panel.isChannel()) return;
                        panel.addMsg('', msg, 'action join');
                    });
                    _kiwi.app.panels.server.addMsg('', msg, 'action join');

                    gw_stat = 0;
                });
            })();


            gw.on('onjoin', function (event) {
                var c, members, user;
                c = that.panels.getByName(event.channel);
                if (!c) {
                    c = new _kiwi.model.Channel({name: event.channel});
                    that.panels.add(c);
                }

                members = c.get('members');
                if (!members) return;

                user = new _kiwi.model.Member({nick: event.nick, ident: event.ident, hostname: event.hostname});
                members.add(user);
                // TODO: highlight the new channel in some way
            });


            gw.on('onpart', function (event) {
                var channel, members, user,
                    part_options = {};

                part_options.type = 'part';
                part_options.message = event.message || '';

                channel = that.panels.getByName(event.channel);
                if (!channel) return;

                // If this is us, close the panel
                if (event.nick === _kiwi.gateway.get('nick')) {
                    channel.close();
                    return;
                }

                members = channel.get('members');
                if (!members) return;

                user = members.getByNick(event.nick);
                if (!user) return;

                members.remove(user, part_options);
            });


            gw.on('onquit', function (event) {
                var member, members,
                    quit_options = {};

                quit_options.type = 'quit';
                quit_options.message = event.message || '';

                $.each(that.panels.models, function (index, panel) {
                    if (!panel.isChannel()) return;

                    member = panel.get('members').getByNick(event.nick);
                    if (member) {
                        panel.get('members').remove(member, quit_options);
                    }
                });
            });


            gw.on('onkick', function (event) {
                var channel, members, user,
                    part_options = {};

                part_options.type = 'kick';
                part_options.by = event.nick;
                part_options.message = event.message || '';

                channel = that.panels.getByName(event.channel);
                if (!channel) return;

                members = channel.get('members');
                if (!members) return;

                user = members.getByNick(event.kicked);
                if (!user) return;

                members.remove(user, part_options);

                if (event.kicked === _kiwi.gateway.get('nick')) {
                    members.reset([]);
                }
                
            });


            gw.on('onmsg', function (event) {
                var panel,
                    is_pm = (event.channel == _kiwi.gateway.get('nick'));

                if (is_pm) {
                    // If a panel isn't found for this PM, create one
                    panel = that.panels.getByName(event.nick);
                    if (!panel) {
                        panel = new _kiwi.model.Query({name: event.nick});
                        that.panels.add(panel);
                    }

                } else {
                    // If a panel isn't found for this channel, reroute to the
                    // server panel
                    panel = that.panels.getByName(event.channel);
                    if (!panel) {
                        panel = that.panels.server;
                    }
                }
                
                panel.addMsg(event.nick, event.msg);
            });


            gw.on('onctcp_request', function (event) {
                // Reply to a TIME ctcp
                if (event.msg.toUpperCase() === 'TIME') {
                    gw.ctcp(false, event.type, event.nick, (new Date()).toString());
                }
            });


            gw.on('onctcp_response', function (event) {
                that.panels.server.addMsg('[' + event.nick + ']', 'CTCP ' + event.msg);
            });


            gw.on('onnotice', function (event) {
                var panel;

                // Find a panel for the destination(channel) or who its from
                panel = that.panels.getByName(event.target) || that.panels.getByName(event.nick);
                if (!panel) {
                    panel = that.panels.server;
                }

                panel.addMsg('[' + (event.nick||'') + ']', event.msg);
            });


            gw.on('onaction', function (event) {
                var panel,
                    is_pm = (event.channel == _kiwi.gateway.get('nick'));

                if (is_pm) {
                    // If a panel isn't found for this PM, create one
                    panel = that.panels.getByName(event.nick);
                    if (!panel) {
                        panel = new _kiwi.model.Channel({name: event.nick});
                        that.panels.add(panel);
                    }

                } else {
                    // If a panel isn't found for this channel, reroute to the
                    // server panel
                    panel = that.panels.getByName(event.channel);
                    if (!panel) {
                        panel = that.panels.server;
                    }
                }

                panel.addMsg('', '* ' + event.nick + ' ' + event.msg, 'action');
            });


            gw.on('ontopic', function (event) {
                var c;
                c = that.panels.getByName(event.channel);
                if (!c) return;

                // Set the channels topic
                c.set('topic', event.topic);

                // If this is the active channel, update the topic bar too
                if (c.get('name') === _kiwi.app.panels.active.get('name')) {
                    that.topicbar.setCurrentTopic(event.topic);
                }
            });


            gw.on('ontopicsetby', function (event) {
                var c, when;
                c = that.panels.getByName(event.channel);
                if (!c) return;

                when = formatDate(new Date(event.when * 1000));
                c.addMsg('', 'Topic set by ' + event.nick + ' at ' + when, 'topic');
            });


            gw.on('onuserlist', function (event) {
                var channel;
                channel = that.panels.getByName(event.channel);

                // If we didn't find a channel for this, may aswell leave
                if (!channel) return;

                channel.temp_userlist = channel.temp_userlist || [];
                _.each(event.users, function (item) {
                    var user = new _kiwi.model.Member({nick: item.nick, modes: item.modes});
                    channel.temp_userlist.push(user);
                });
            });


            gw.on('onuserlist_end', function (event) {
                var channel;
                channel = that.panels.getByName(event.channel);

                // If we didn't find a channel for this, may aswell leave
                if (!channel) return;

                // Update the members list with the new list
                channel.get('members').reset(channel.temp_userlist || []);

                // Clear the temporary userlist
                delete channel.temp_userlist;
            });


            gw.on('onmode', function (event) {
                var channel, i, prefixes, members, member, find_prefix;
                
                // Build a nicely formatted string to be displayed to a regular human
                function friendlyModeString (event_modes, alt_target) {
                    var modes = {}, return_string;

                    // If no default given, use the main event info
                    if (!event_modes) {
                        event_modes = event.modes;
                        alt_target = event.target;
                    }

                    // Reformat the mode object to make it easier to work with
                    _.each(event_modes, function (mode){
                        var param = mode.param || alt_target || '';

                        // Make sure we have some modes for this param
                        if (!modes[param]) {
                            modes[param] = {'+':'', '-':''};
                        }

                        modes[param][mode.mode[0]] += mode.mode.substr(1);
                    });

                    // Put the string together from each mode
                    return_string = [];
                    _.each(modes, function (modeset, param) {
                        var str = '';
                        if (modeset['+']) str += '+' + modeset['+'];
                        if (modeset['-']) str += '-' + modeset['-'];
                        return_string.push(str + ' ' + param);
                    });
                    return_string = return_string.join(', ');

                    return return_string;
                }


                channel = that.panels.getByName(event.target);
                if (channel) {
                    prefixes = _kiwi.gateway.get('user_prefixes');
                    find_prefix = function (p) {
                        return event.modes[i].mode[1] === p.mode;
                    };
                    for (i = 0; i < event.modes.length; i++) {
                        if (_.any(prefixes, find_prefix)) {
                            if (!members) {
                                members = channel.get('members');
                            }
                            member = members.getByNick(event.modes[i].param);
                            if (!member) {
                                console.log('MODE command recieved for unknown member %s on channel %s', event.modes[i].param, event.target);
                                return;
                            } else {
                                if (event.modes[i].mode[0] === '+') {
                                    member.addMode(event.modes[i].mode[1]);
                                } else if (event.modes[i].mode[0] === '-') {
                                    member.removeMode(event.modes[i].mode[1]);
                                }
                                members.sort();
                                //channel.addMsg('', '== ' + event.nick + ' set mode ' + event.modes[i].mode + ' ' + event.modes[i].param, 'action mode');
                            }
                        } else {
                            // Channel mode being set
                            // TODO: Store this somewhere?
                            //channel.addMsg('', 'CHANNEL === ' + event.nick + ' set mode ' + event.modes[i].mode + ' on ' + event.target, 'action mode');
                        }
                    }

                    channel.addMsg('', '== ' + event.nick + ' sets mode ' + friendlyModeString(), 'action mode');
                } else {
                    // This is probably a mode being set on us.
                    if (event.target.toLowerCase() === _kiwi.gateway.get("nick").toLowerCase()) {
                        that.panels.server.addMsg('', '== ' + event.nick + ' set mode ' + friendlyModeString(), 'action mode');
                    } else {
                       console.log('MODE command recieved for unknown target %s: ', event.target, event);
                    }
                }
            });


            gw.on('onnick', function (event) {
                var member;

                $.each(that.panels.models, function (index, panel) {
                    if (!panel.isChannel()) return;

                    member = panel.get('members').getByNick(event.nick);
                    if (member) {
                        member.set('nick', event.newnick);
                        panel.addMsg('', '== ' + event.nick + ' is now known as ' + event.newnick, 'action nick');
                    }
                });
            });


            gw.on('onwhois', function (event) {
                /*globals secondsToTime */
                var logon_date, idle_time = '', panel;

                if (event.end) {
                    return;
                }

                if (typeof event.idle !== 'undefined') {
                    idle_time = secondsToTime(parseInt(event.idle, 10));
                    idle_time = idle_time.h.toString().lpad(2, "0") + ':' + idle_time.m.toString().lpad(2, "0") + ':' + idle_time.s.toString().lpad(2, "0");
                }

                panel = _kiwi.app.panels.active;
                if (event.ident) {
                    panel.addMsg(event.nick, event.nick + ' [' + event.nick + '!' + event.ident + '@' + event.host + '] * ' + event.msg, 'whois');
                } else if (event.chans) {
                    panel.addMsg(event.nick, 'Channels: ' + event.chans, 'whois');
                } else if (event.irc_server) {
                    panel.addMsg(event.nick, 'Connected to server: ' + event.irc_server, 'whois');
                } else if (event.msg) {
                    panel.addMsg(event.nick, event.msg, 'whois');
                } else if (event.logon) {
                    logon_date = new Date();
                    logon_date.setTime(event.logon * 1000);
                    logon_date = formatDate(logon_date);

                    panel.addMsg(event.nick, 'idle for ' + idle_time + ', signed on ' + logon_date, 'whois');
                } else {
                    panel.addMsg(event.nick, 'idle for ' + idle_time, 'whois');
                }
            });

            gw.on('onaway', function (event) {
                $.each(that.panels.models, function (index, panel) {
                    if (!panel.isChannel()) return;

                    member = panel.get('members').getByNick(event.nick);
                    if (member) {
                        member.set('away', !(!event.trailing));
                    }
                });
            });


            gw.on('onlist_start', function (data) {
                if (_kiwi.app.channel_list) {
                    _kiwi.app.channel_list.close();
                    delete _kiwi.app.channel_list;
                }

                var panel = new _kiwi.model.Applet(),
                    applet = new _kiwi.applets.Chanlist();

                panel.load(applet);
                
                _kiwi.app.panels.add(panel);
                panel.view.show();
                
                _kiwi.app.channel_list = applet;
            });


            gw.on('onlist_channel', function (data) {
                // TODO: Put this listener within the applet itself
                _kiwi.app.channel_list.addChannel(data.chans);
            });


            gw.on('onlist_end', function (data) {
                // TODO: Put this listener within the applet itself
                delete _kiwi.app.channel_list;
            });


            gw.on('onirc_error', function (data) {
                var panel, tmp;

                if (data.channel !== undefined && !(panel = _kiwi.app.panels.getByName(data.channel))) {
                    panel = _kiwi.app.panels.server;
                }

                switch (data.error) {
                case 'banned_from_channel':
                    panel.addMsg(' ', '== You are banned from ' + data.channel + '. ' + data.reason, 'status');
                    _kiwi.app.message.text('You are banned from ' + data.channel + '. ' + data.reason);
                    break;
                case 'bad_channel_key':
                    panel.addMsg(' ', '== Bad channel key for ' + data.channel, 'status');
                    _kiwi.app.message.text('Bad channel key or password for ' + data.channel);
                    break;
                case 'invite_only_channel':
                    panel.addMsg(' ', '== ' + data.channel + ' is invite only.', 'status');
                    _kiwi.app.message.text(data.channel + ' is invite only');
                    break;
                case 'channel_is_full':
                    panel.addMsg(' ', '== ' + data.channel + ' is full.', 'status');
                    _kiwi.app.message.text(data.channel + ' is full');
                    break;
                case 'chanop_privs_needed':
                    panel.addMsg(' ', '== ' + data.reason, 'status');
                    _kiwi.app.message.text(data.reason + ' (' + data.channel + ')');
                    break;
                case 'no_such_nick':
                    tmp = _kiwi.app.panels.getByName(data.nick);
                    if (tmp) {
                        tmp.addMsg(' ', '== ' + data.nick + ': ' + data.reason, 'status');
                    } else {
                        _kiwi.app.panels.server.addMsg(' ', '== ' + data.nick + ': ' + data.reason, 'status');
                    }
                    break;
                case 'nickname_in_use':
                    _kiwi.app.panels.server.addMsg(' ', '== The nickname ' + data.nick + ' is already in use. Please select a new nickname', 'status');
                    if (_kiwi.app.panels.server !== _kiwi.app.panels.active) {
                        _kiwi.app.message.text('The nickname "' + data.nick + '" is already in use. Please select a new nickname');
                    }

                    // Only show the nickchange component if the controlbox is open
                    if (that.controlbox.$el.css('display') !== 'none') {
                        (new _kiwi.view.NickChangeBox()).render();
                    }

                case 'password_mismatch':
                    _kiwi.app.panels.server.addMsg(' ', '== Incorrect password given', 'status');
                    break;
                default:
                    // We don't know what data contains, so don't do anything with it.
                    //_kiwi.front.tabviews.server.addMsg(null, ' ', '== ' + data, 'status');
                }
            });
        };



        /**
         * Bind to certain commands that may be typed into the control box
         */
        this.bindControllboxCommands = function (controlbox) {
            // Default aliases
            $.extend(controlbox.preprocessor.aliases, {
                // General aliases
                '/p': '/part $1+',
                '/me': '/action $1+',
                '/j': '/join $1+',
                '/q': '/query $1+',

                // Op related aliases
                '/op': '/quote mode $channel +o $1+',
                '/deop': '/quote mode $channel -o $1+',
                '/hop': '/quote mode $channel +h $1+',
                '/dehop': '/quote mode $channel -h $1+',
                '/voice': '/quote mode $channel +v $1+',
                '/devoice': '/quote mode $channel -v $1+',
                '/k': '/kick $channel $1+',

                // Misc aliases
                '/slap': '/me slaps $1 around a bit with a large trout'
            });

            controlbox.on('unknown_command', unknownCommand);

            controlbox.on('command', allCommands);
            controlbox.on('command:msg', msgCommand);

            controlbox.on('command:action', actionCommand);

            controlbox.on('command:join', joinCommand);

            controlbox.on('command:part', partCommand);

            controlbox.on('command:nick', function (ev) {
                _kiwi.gateway.changeNick(ev.params[0]);
            });

            controlbox.on('command:query', queryCommand);

            controlbox.on('command:topic', topicCommand);

            controlbox.on('command:notice', noticeCommand);

            controlbox.on('command:quote', quoteCommand);

            controlbox.on('command:kick', kickCommand);

            controlbox.on('command:clear', clearCommand);

            controlbox.on('command_ctcp', ctcpCommand);


            controlbox.on('command:css', function (ev) {
                var queryString = '?reload=' + new Date().getTime();
                $('link[rel="stylesheet"]').each(function () {
                    this.href = this.href.replace(/\?.*|$/, queryString);
                });
            });

            controlbox.on('command:js', function (ev) {
                if (!ev.params[0]) return;
                $script(ev.params[0] + '?' + (new Date().getTime()));
            });

            
            controlbox.on('command:set', function (ev) {
                if (!ev.params[0]) return;

                var setting = ev.params[0],
                    value;

                // Do we have a second param to set a value?
                if (ev.params[1]) {
                    ev.params.shift();

                    value = ev.params.join(' ');
                    _kiwi.global.settings.set(setting, value);
                }

                // Read the value to the user
                _kiwi.app.panels.active.addMsg('', setting + ' = ' + _kiwi.global.settings.get(setting));
            });


            controlbox.on('command:save', function (ev) {
                _kiwi.global.settings.save();
                _kiwi.app.panels.active.addMsg('', 'Settings have been saved');
            });


            controlbox.on('command:alias', function (ev) {
                var name, rule;

                // No parameters passed so list them
                if (!ev.params[1]) {
                    $.each(controlbox.preprocessor.aliases, function (name, rule) {
                        _kiwi.app.panels.server.addMsg(' ', name + '   =>   ' + rule);
                    });
                    return;
                }

                // Deleting an alias?
                if (ev.params[0] === 'del' || ev.params[0] === 'delete') {
                    name = ev.params[1];
                    if (name[0] !== '/') name = '/' + name;
                    delete controlbox.preprocessor.aliases[name];
                    return;
                }

                // Add the alias
                name = ev.params[0];
                ev.params.shift();
                rule = ev.params.join(' ');

                // Make sure the name starts with a slash
                if (name[0] !== '/') name = '/' + name;

                // Now actually add the alias
                controlbox.preprocessor.aliases[name] = rule;
            });

            controlbox.on('command:applet', appletCommand);
            controlbox.on('command:settings', settingsCommand);
            controlbox.on('command:script', scriptCommand);
        };

        // A fallback action. Send a raw command to the server
        function unknownCommand (ev) {
            var raw_cmd = ev.command + ' ' + ev.params.join(' ');
            console.log('RAW: ' + raw_cmd);
            _kiwi.gateway.raw(raw_cmd);
        }

        function allCommands (ev) {}

        function joinCommand (ev) {
            var channel, channel_names;

            channel_names = ev.params.join(' ').split(',');

            $.each(channel_names, function (index, channel_name) {
                // Trim any whitespace off the name
                channel_name = channel_name.trim();

                // Check if we have the panel already. If not, create it
                channel = that.panels.getByName(channel_name);
                if (!channel) {
                    channel = new _kiwi.model.Channel({name: channel_name});
                    _kiwi.app.panels.add(channel);
                }

                _kiwi.gateway.join(channel_name);
            });

            if (channel) channel.view.show();
            
        }

        function queryCommand (ev) {
            var destination, panel;

            destination = ev.params[0];

            // Check if we have the panel already. If not, create it
            panel = that.panels.getByName(destination);
            if (!panel) {
                panel = new _kiwi.model.Query({name: destination});
                _kiwi.app.panels.add(panel);
            }

            if (panel) panel.view.show();
            
        }

        function msgCommand (ev) {
            var destination = ev.params[0],
                panel = that.panels.getByName(destination) || that.panels.server;

            ev.params.shift();

            panel.addMsg(_kiwi.gateway.get('nick'), ev.params.join(' '));
            _kiwi.gateway.privmsg(destination, ev.params.join(' '));
        }

        function actionCommand (ev) {
            if (_kiwi.app.panels.active === _kiwi.app.panels.server) {
                return;
            }

            var panel = _kiwi.app.panels.active;
            panel.addMsg('', '* ' + _kiwi.gateway.get('nick') + ' ' + ev.params.join(' '), 'action');
            _kiwi.gateway.action(panel.get('name'), ev.params.join(' '));
        }

        function partCommand (ev) {
            if (ev.params.length === 0) {
                _kiwi.gateway.part(_kiwi.app.panels.active.get('name'));
            } else {
                _.each(ev.params, function (channel) {
                    _kiwi.gateway.part(channel);
                });
            }
            // TODO: More responsive = close tab now, more accurate = leave until part event
            //_kiwi.app.panels.remove(_kiwi.app.panels.active);
        }

        function topicCommand (ev) {
            var channel_name;

            if (ev.params.length === 0) return;

            if (that.isChannelName(ev.params[0])) {
                channel_name = ev.params[0];
                ev.params.shift();
            } else {
                channel_name = _kiwi.app.panels.active.get('name');
            }

            _kiwi.gateway.topic(channel_name, ev.params.join(' '));
        }

        function noticeCommand (ev) {
            var destination;

            // Make sure we have a destination and some sort of message
            if (ev.params.length <= 1) return;

            destination = ev.params[0];
            ev.params.shift();

            _kiwi.gateway.notice(destination, ev.params.join(' '));
        }

        function quoteCommand (ev) {
            var raw = ev.params.join(' ');
            _kiwi.gateway.raw(raw);
        }

        function kickCommand (ev) {
            var nick, panel = _kiwi.app.panels.active;

            if (!panel.isChannel()) return;

            // Make sure we have a nick
            if (ev.params.length === 0) return;

            nick = ev.params[0];
            ev.params.shift();

            _kiwi.gateway.kick(panel.get('name'), nick, ev.params.join(' '));
        }

        function clearCommand (ev) {
            // Can't clear a server or applet panel
            if (_kiwi.app.panels.active.isServer() || _kiwi.app.panels.active.isApplet()) {
                return;
            }

            if (_kiwi.app.panels.active.clearMessages) {
                _kiwi.app.panels.active.clearMessages();
            }
        }

        function ctcpCommand(ev) {
            var target, type;

            // Make sure we have a target and a ctcp type (eg. version, time)
            if (ev.params.length < 2) return;

            target = ev.params[0];
            ev.params.shift();

            type = ev.params[0];
            ev.params.shift();

            _kiwi.gateway.ctcp(true, type, target, ev.params.join(' '));
        }

        function settingsCommand (ev) {
            var settings = _kiwi.model.Applet.loadOnce('kiwi_settings');
            settings.view.show();
        }

        function scriptCommand (ev) {
            var editor = _kiwi.model.Applet.loadOnce('kiwi_script_editor');
            editor.view.show();
        }

        function appletCommand (ev) {
            if (!ev.params[0]) return;

            var panel = new _kiwi.model.Applet();

            if (ev.params[1]) {
                // Url and name given
                panel.load(ev.params[0], ev.params[1]);
            } else {
                // Load a pre-loaded applet
                if (_kiwi.applets[ev.params[0]]) {
                    panel.load(new _kiwi.applets[ev.params[0]]());
                } else {
                    _kiwi.app.panels.server.addMsg('', 'Applet "' + ev.params[0] + '" does not exist');
                    return;
                }
            }
            
            _kiwi.app.panels.add(panel);
            panel.view.show();
        }





        this.isChannelName = function (channel_name) {
            var channel_prefix = _kiwi.gateway.get('channel_prefix');

            if (!channel_name || !channel_name.length) return false;
            return (channel_prefix.indexOf(channel_name[0]) > -1);
        };

    };


    model = Backbone.Model.extend(new model());

    return new model(arguments);
};



_kiwi.model.Gateway = function () {

    // Set to a reference to this object within initialize()
    var that = null;

    this.defaults = {
        /**
        *   The name of the network
        *   @type    String
        */
        name: 'Server',

        /**
        *   The address (URL) of the network
        *   @type    String
        */
        address: '',

        /**
        *   The current nickname
        *   @type   String
        */
        nick: '',

        /**
        *   The channel prefix for this network
        *   @type    String
        */
        channel_prefix: '#',

        /**
        *   The user prefixes for channel owner/admin/op/voice etc. on this network
        *   @type   Array
        */
        user_prefixes: ['~', '&', '@', '+'],

        /**
        *   The URL to the Kiwi server
        *   @type   String
        */
        kiwi_server: '//kiwi'
    };


    this.initialize = function () {
        that = this;
        
        // For ease of access. The socket.io object
        this.socket = this.get('socket');

        this.applyEventHandlers();
    };


    this.applyEventHandlers = function () {
        /*
        kiwi.gateway.on('message:#channel', my_function);
        kiwi.gateway.on('message:somenick', my_function);

        kiwi.gateway.on('notice:#channel', my_function);
        kiwi.gateway.on('action:somenick', my_function);

        kiwi.gateway.on('join:#channel', my_function);
        kiwi.gateway.on('part:#channel', my_function);
        kiwi.gateway.on('quit', my_function);
        */
        var that = this;
        
        // Some easier handler events
        this.on('onmsg', function (event) {
            var source,
                is_pm = (event.channel == that.get('nick'));

            source = is_pm ? event.nick : event.channel;
            
            that.trigger('message:' + source, event);
            that.trigger('message', event);

            if (is_pm) {
                that.trigger('pm:' + source, event);
                that.trigger('pm', event);
            }
        }, this);


        this.on('onnotice', function (event) {
            // The notice towards a channel or a query window?
            var source = event.target || event.nick;

            this.trigger('notice:' + source, event);
            this.trigger('notice', event);
        }, this);


        this.on('onaction', function (event) {
            var source,
                is_pm = (event.channel == that.get('nick'));

            source = is_pm ? event.nick : event.channel;
            
            that.trigger('action:' + source, event);

            if (is_pm) {
                that.trigger('action:' + source, event);
                that.trigger('action', event);
            }
        }, this);


        this.on('ontopic', function (event) {
            that.trigger('topic:' + event.channel, event);
            that.trigger('topic', event);
        });


        this.on('onjoin', function (event) {
            that.trigger('join:' + event.channel, event);
            that.trigger('join', event);
        });

    };



    /**
    *   Connects to the server
    *   @param  {String}    host        The hostname or IP address of the IRC server to connect to
    *   @param  {Number}    port        The port of the IRC server to connect to
    *   @param  {Boolean}   ssl         Whether or not to connect to the IRC server using SSL
    *   @param  {String}    password    The password to supply to the IRC server during registration
    *   @param  {Function}  callback    A callback function to be invoked once Kiwi's server has connected to the IRC server
    */
    this.connect = function (host, port, ssl, password, callback) {
        var resource;

        // Work out the resource URL for socket.io
        if (_kiwi.app.get('base_path').substr(0, 1) === '/') {
            resource = _kiwi.app.get('base_path');
            resource = resource.substr(1, resource.length-1);
            resource += '/transport';
        } else {
            resource = _kiwi.app.get('base_path') + '/transport';
        }

        this.socket = io.connect(this.get('kiwi_server'), {
            'resource': resource,
            
            'try multiple transports': true,
            'connect timeout': 3000,
            'max reconnection attempts': 7,
            'reconnection delay': 2000,
            'sync disconnect on unload': false
        });
        this.socket.on('connect_failed', function (reason) {
            this.socket.disconnect();
            this.trigger("connect_fail", {reason: reason});
        });

        this.socket.on('error', function (e) {
            console.log("_kiwi.gateway.socket.on('error')", {reason: e});
            that.trigger("connect_fail", {reason: e});
        });

        this.socket.on('connecting', function (transport_type) {
            console.log("_kiwi.gateway.socket.on('connecting')");
            that.trigger("connecting");
        });

        /**
         * Once connected to the kiwi server send the IRC connect command along
         * with the IRC server details.
         * A `connect` event is sent from the kiwi server once connected to the
         * IRCD and the nick has been accepted.
         */
        this.socket.on('connect', function () {
            this.emit('kiwi', {command: 'connect', nick: that.get('nick'), hostname: host, port: port, ssl: ssl, password:password}, function (err, server_num) {
                if (!err) {
                    that.server_num = server_num;
                    console.log("_kiwi.gateway.socket.on('connect')");
                } else {
                    console.log("_kiwi.gateway.socket.on('error')", {reason: err});
                    callback(err);
                }
            });
        });

        this.socket.on('too_many_connections', function () {
            that.trigger("connect_fail", {reason: 'too_many_connections'});
        });

        this.socket.on('irc', function (data, callback) {
            that.parse(data.command, data.data);
        });

        this.socket.on('kiwi', function (data, callback) {
            that.parseKiwi(data.command, data.data);
        });

        this.socket.on('disconnect', function () {
            that.trigger("disconnect", {});
            console.log("_kiwi.gateway.socket.on('disconnect')");
        });

        this.socket.on('close', function () {
            console.log("_kiwi.gateway.socket.on('close')");
        });

        this.socket.on('reconnecting', function (reconnectionDelay, reconnectionAttempts) {
            console.log("_kiwi.gateway.socket.on('reconnecting')");
            that.trigger("reconnecting", {delay: reconnectionDelay, attempts: reconnectionAttempts});
        });

        this.socket.on('reconnect_failed', function () {
            console.log("_kiwi.gateway.socket.on('reconnect_failed')");
        });
    };



    this.isConnected = function () {
        return this.socket.socket.connected;
    };



    this.parseKiwi = function (command, data) {
        this.trigger('kiwi:' + command, data);
        this.trigger('kiwi', data);
    };
    /*
        Events:
            msg
            action
            server_connect
            options
            motd
            notice
            userlist
            nick
            join
            topic
            part
            kick
            quit
            whois
            syncchannel_redirect
            debug
    */
    /**
    *   Parses the response from the server
    */
    this.parse = function (command, data) {
        //console.log('gateway event', command, data);
        if (command !== undefined) {
            that.trigger('on' + command, data);

            switch (command) {
            case 'options':
                $.each(data.options, function (name, value) {
                    switch (name) {
                    case 'CHANTYPES':
                        // TODO: Check this. Why is it only getting the first char?
                        that.set('channel_prefix', value.join('').charAt(0));
                        break;
                    case 'NETWORK':
                        that.set('name', value);
                        break;
                    case 'PREFIX':
                        that.set('user_prefixes', value);
                        break;
                    }
                });
                that.set('cap', data.cap);
                break;

            case 'connect':
                that.set('nick', data.nick);
                break;

            case 'nick':
                if (data.nick === that.get('nick')) {
                    that.set('nick', data.newnick);
                }
                break;
            /*
            case 'sync':
                if (_kiwi.gateway.onSync && _kiwi.gateway.syncing) {
                    _kiwi.gateway.syncing = false;
                    _kiwi.gateway.onSync(item);
                }
                break;
            */

            case 'kiwi':
                this.emit('_kiwi.' + data.namespace, data.data);
                break;
            }
        }
    };

    /**
    *   Sends data to the server
    *   @private
    *   @param  {Object}    data        The data to send
    *   @param  {Function}  callback    A callback function
    */
    this.sendData = function (data, callback) {
        this.socket.emit('irc', {server: 0, data: JSON.stringify(data)}, callback);
    };

    /**
    *   Sends a PRIVMSG message
    *   @param  {String}    target      The target of the message (e.g. a channel or nick)
    *   @param  {String}    msg         The message to send
    *   @param  {Function}  callback    A callback function
    */
    this.privmsg = function (target, msg, callback) {
        var data = {
            method: 'privmsg',
            args: {
                target: target,
                msg: msg
            }
        };

        this.sendData(data, callback);
    };

    /**
    *   Sends a NOTICE message
    *   @param  {String}    target      The target of the message (e.g. a channel or nick)
    *   @param  {String}    msg         The message to send
    *   @param  {Function}  callback    A callback function
    */
    this.notice = function (target, msg, callback) {
        var data = {
            method: 'notice',
            args: {
                target: target,
                msg: msg
            }
        };

        this.sendData(data, callback);
    };

    /**
    *   Sends a CTCP message
    *   @param  {Boolean}   request     Indicates whether this is a CTCP request (true) or reply (false)
    *   @param  {String}    type        The type of CTCP message, e.g. 'VERSION', 'TIME', 'PING' etc.
    *   @param  {String}    target      The target of the message, e.g a channel or nick
    *   @param  {String}    params      Additional paramaters
    *   @param  {Function}  callback    A callback function
    */
    this.ctcp = function (request, type, target, params, callback) {
        var data = {
            method: 'ctcp',
            args: {
                request: request,
                type: type,
                target: target,
                params: params
            }
        };

        this.sendData(data, callback);
    };

    /**
    *   @param  {String}    target      The target of the message (e.g. a channel or nick)
    *   @param  {String}    msg         The message to send
    *   @param  {Function}  callback    A callback function
    */
    this.action = function (target, msg, callback) {
        this.ctcp(true, 'ACTION', target, msg, callback);
    };

    /**
    *   Joins a channel
    *   @param  {String}    channel     The channel to join
    *   @param  {String}    key         The key to the channel
    *   @param  {Function}  callback    A callback function
    */
    this.join = function (channel, key, callback) {
        var data = {
            method: 'join',
            args: {
                channel: channel,
                key: key
            }
        };

        this.sendData(data, callback);
    };

    /**
    *   Leaves a channel
    *   @param  {String}    channel     The channel to part
    *   @param  {Function}  callback    A callback function
    */
    this.part = function (channel, callback) {
        var data = {
            method: 'part',
            args: {
                channel: channel
            }
        };

        this.sendData(data, callback);
    };

    /**
    *   Queries or modifies a channell topic
    *   @param  {String}    channel     The channel to query or modify
    *   @param  {String}    new_topic   The new topic to set
    *   @param  {Function}  callback    A callback function
    */
    this.topic = function (channel, new_topic, callback) {
        var data = {
            method: 'topic',
            args: {
                channel: channel,
                topic: new_topic
            }
        };

        this.sendData(data, callback);
    };

    /**
    *   Kicks a user from a channel
    *   @param  {String}    channel     The channel to kick the user from
    *   @param  {String}    nick        The nick of the user to kick
    *   @param  {String}    reason      The reason for kicking the user
    *   @param  {Function}  callback    A callback function
    */
    this.kick = function (channel, nick, reason, callback) {
        var data = {
            method: 'kick',
            args: {
                channel: channel,
                nick: nick,
                reason: reason
            }
        };

        this.sendData(data, callback);
    };

    /**
    *   Disconnects us from the server
    *   @param  {String}    msg         The quit message to send to the IRC server
    *   @param  {Function}   callback    A callback function
    */
    this.quit = function (msg, callback) {
        msg = msg || "";
        var data = {
            method: 'quit',
            args: {
                message: msg
            }
        };

        this.sendData(data, callback);
    };

    /**
    *   Sends a string unmodified to the IRC server
    *   @param  {String}    data        The data to send to the IRC server
    *   @param  {Function}  callback    A callback function
    */
    this.raw = function (data, callback) {
        data = {
            method: 'raw',
            args: {
                data: data
            }
        };

        this.sendData(data, callback);
    };

    /**
    *   Changes our nickname
    *   @param  {String}    new_nick    Our new nickname
    *   @param  {Function}  callback    A callback function
    */
    this.changeNick = function (new_nick, callback) {
        var data = {
            method: 'nick',
            args: {
                nick: new_nick
            }
        };

        this.sendData(data, callback);
    };

    /**
    *   Sends data to a fellow Kiwi IRC user
    *   @param  {String}    target      The nick of the Kiwi IRC user to send to
    *   @param  {String}    data        The data to send
    *   @param  {Function}  callback    A callback function
    */
    this.kiwi = function (target, data, callback) {
        data = {
            method: 'kiwi',
            args: {
                target: target,
                data: data
            }
        };

        this.sendData(data, callback);
    };


    return new (Backbone.Model.extend(this))(arguments);
};


_kiwi.model.Member = Backbone.Model.extend({
    sortModes: function (modes) {
        return modes.sort(function (a, b) {
            var a_idx, b_idx, i;
            var user_prefixes = _kiwi.gateway.get('user_prefixes');

            for (i = 0; i < user_prefixes.length; i++) {
                if (user_prefixes[i].mode === a) {
                    a_idx = i;
                }
            }
            for (i = 0; i < user_prefixes.length; i++) {
                if (user_prefixes[i].mode === b) {
                    b_idx = i;
                }
            }
            if (a_idx < b_idx) {
                return -1;
            } else if (a_idx > b_idx) {
                return 1;
            } else {
                return 0;
            }
        });
    },
    initialize: function (attributes) {
        var nick, modes, prefix;
        nick = this.stripPrefix(this.get("nick"));

        modes = this.get("modes");
        modes = modes || [];
        this.sortModes(modes);
        this.set({"nick": nick, "modes": modes, "prefix": this.getPrefix(modes)}, {silent: true});
    },
    addMode: function (mode) {
        var modes_to_add = mode.split(''),
            modes, prefix;

        modes = this.get("modes");
        $.each(modes_to_add, function (index, item) {
            modes.push(item);
        });
        
        modes = this.sortModes(modes);
        this.set({"prefix": this.getPrefix(modes), "modes": modes});
    },
    removeMode: function (mode) {
        var modes_to_remove = mode.split(''),
            modes, prefix;

        modes = this.get("modes");
        modes = _.reject(modes, function (m) {
            return (_.indexOf(modes_to_remove, m) !== -1);
        });

        this.set({"prefix": this.getPrefix(modes), "modes": modes});
    },
    getPrefix: function (modes) {
        var prefix = '';
        var user_prefixes = _kiwi.gateway.get('user_prefixes');

        if (typeof modes[0] !== 'undefined') {
            prefix = _.detect(user_prefixes, function (prefix) {
                return prefix.mode === modes[0];
            });
            prefix = (prefix) ? prefix.symbol : '';
        }
        return prefix;
    },
    stripPrefix: function (nick) {
        var tmp = nick, i, j, k;
        var user_prefixes = _kiwi.gateway.get('user_prefixes');
        i = 0;

        for (j = 0; j < nick.length; j++) {
            for (k = 0; k < user_prefixes.length; k++) {
                if (nick.charAt(j) === user_prefixes[k].symbol) {
                    i++;
                    break;
                }
            }
        }

        return tmp.substr(i);
    },
    displayNick: function (full) {
        var display = this.get('nick');

        if (full) {
            if (this.get("ident")) {
                display += ' [' + this.get("ident") + '@' + this.get("hostname") + ']';
            }
        }

        return display;
    }
});


_kiwi.model.MemberList = Backbone.Collection.extend({
    model: _kiwi.model.Member,
    comparator: function (a, b) {
        var i, a_modes, b_modes, a_idx, b_idx, a_nick, b_nick;
        var user_prefixes = _kiwi.gateway.get('user_prefixes');
        a_modes = a.get("modes");
        b_modes = b.get("modes");
        // Try to sort by modes first
        if (a_modes.length > 0) {
            // a has modes, but b doesn't so a should appear first
            if (b_modes.length === 0) {
                return -1;
            }
            a_idx = b_idx = -1;
            // Compare the first (highest) mode
            for (i = 0; i < user_prefixes.length; i++) {
                if (user_prefixes[i].mode === a_modes[0]) {
                    a_idx = i;
                }
            }
            for (i = 0; i < user_prefixes.length; i++) {
                if (user_prefixes[i].mode === b_modes[0]) {
                    b_idx = i;
                }
            }
            if (a_idx < b_idx) {
                return -1;
            } else if (a_idx > b_idx) {
                return 1;
            }
            // If we get to here both a and b have the same highest mode so have to resort to lexicographical sorting

        } else if (b_modes.length > 0) {
            // b has modes but a doesn't so b should appear first
            return 1;
        }
        a_nick = a.get("nick").toLocaleUpperCase();
        b_nick = b.get("nick").toLocaleUpperCase();
        // Lexicographical sorting
        if (a_nick < b_nick) {
            return -1;
        } else if (a_nick > b_nick) {
            return 1;
        } else {
            return 0;
        }
    },
    initialize: function (options) {
        this.view = new _kiwi.view.MemberList({"model": this});
    },
    getByNick: function (nick) {
        if (typeof nick !== 'string') return;
        return this.find(function (m) {
            return nick.toLowerCase() === m.get('nick').toLowerCase();
        });
    }
});


_kiwi.model.Panel = Backbone.Model.extend({
    initialize: function (attributes) {
        var name = this.get("name") || "";
        this.view = new _kiwi.view.Panel({"model": this, "name": name});
        this.set({
            "scrollback": [],
            "name": name
        }, {"silent": true});
    },

    addMsg: function (nick, msg, type, opts) {
        var message_obj, bs, d,
            scrollback = (parseInt(_kiwi.global.settings.get('scrollback'), 10) || 250);

        opts = opts || {};

        // Time defaults to now
        if (!opts || typeof opts.time === 'undefined') {
            d = new Date();
            opts.time = d.getHours().toString().lpad(2, "0") + ":" + d.getMinutes().toString().lpad(2, "0") + ":" + d.getSeconds().toString().lpad(2, "0");
        }

        // CSS style defaults to empty string
        if (!opts || typeof opts.style === 'undefined') {
            opts.style = '';
        }

        // Run through the plugins
        message_obj = {"msg": msg, "time": opts.time, "nick": nick, "chan": this.get("name"), "type": type, "style": opts.style};
        //tmp = _kiwi.plugs.run('addmsg', message_obj);
        if (!message_obj) {
            return;
        }

        // The CSS class (action, topic, notice, etc)
        if (typeof message_obj.type !== "string") {
            message_obj.type = '';
        }

        // Make sure we don't have NaN or something
        if (typeof message_obj.msg !== "string") {
            message_obj.msg = '';
        }

        // Update the scrollback
        bs = this.get("scrollback");
        bs.push(message_obj);

        // Keep the scrolback limited
        if (bs.length > scrollback) {
            bs.splice(scrollback);
        }
        this.set({"scrollback": bs}, {silent: true});

        this.trigger("msg", message_obj);
    },


    clearMessages: function () {
        this.set({'scrollback': []}, {silent: true});
        this.addMsg('', 'Window cleared');

        this.view.render();
    },

    closePanel: function () {
        if (this.view) {
            this.view.unbind();
            this.view.remove();
            this.view = undefined;
            delete this.view;
        }

        var members = this.get('members');
        if (members) {
            members.reset([]);
            this.unset('members');
        }

        _kiwi.app.panels.remove(this);

        this.unbind();
        this.destroy();

        // If closing the active panel, switch to the server panel
        if (this.cid === _kiwi.app.panels.active.cid) {
            _kiwi.app.panels.server.view.show();
        }
    },

    // Alias to closePanel() for child objects to override
    close: function () {
        return this.closePanel();
    },

    isChannel: function () {
        var channel_prefix = _kiwi.gateway.get('channel_prefix'),
            this_name = this.get('name');

        if (this.isApplet() || !this_name) return false;
        return (channel_prefix.indexOf(this_name[0]) > -1);
    },

    isApplet: function () {
        return this.applet ? true : false;
    },

    isServer: function () {
        return this.server ? true : false;
    },

    isActive: function () {
        return (_kiwi.app.panels.active === this);
    }
});


_kiwi.model.PanelList = Backbone.Collection.extend({
    model: _kiwi.model.Panel,

    comparator: function (chan) {
        return chan.get("name");
    },
    initialize: function () {
        this.view = new _kiwi.view.Tabs({"el": $('#tabs')[0], "model": this});

        // Automatically create a server tab
        this.add(new _kiwi.model.Server({'name': _kiwi.gateway.get('name')}));
        this.server = this.getByName(_kiwi.gateway.get('name'));

        // Holds the active panel
        this.active = null;

        // Keep a tab on the active panel
        this.bind('active', function (active_panel) {
            this.active = active_panel;
        }, this);

    },
    getByName: function (name) {
        if (typeof name !== 'string') return;
        return this.find(function (c) {
            return name.toLowerCase() === c.get('name').toLowerCase();
        });
    }
});


_kiwi.model.Query = _kiwi.model.Panel.extend({
    initialize: function (attributes) {
        var name = this.get("name") || "",
            members;

        this.view = new _kiwi.view.Channel({"model": this, "name": name});
        this.set({
            "name": name,
            "scrollback": []
        }, {"silent": true});
    }
});


// TODO: Channel modes
// TODO: Listen to gateway events for anythign related to this channel
_kiwi.model.Channel = _kiwi.model.Panel.extend({
    initialize: function (attributes) {
        var name = this.get("name") || "",
            members;

        this.view = new _kiwi.view.Channel({"model": this, "name": name});
        this.set({
            "members": new _kiwi.model.MemberList(),
            "name": name,
            "scrollback": [],
            "topic": ""
        }, {"silent": true});

        members = this.get("members");
        members.bind("add", function (member) {
            var show_message = _kiwi.global.settings.get('show_joins_parts');
            if (show_message === false) {
                return;
            }
            
            this.addMsg(' ', '== ' + member.displayNick(true) + ' has joined', 'action join');
        }, this);

        members.bind("remove", function (member, members, options) {
            var show_message = _kiwi.global.settings.get('show_joins_parts');
            if (show_message === false) {
                return;
            }

            var msg = (options.message) ? '(' + options.message + ')' : '';

            if (options.type === 'quit') {
                this.addMsg(' ', '== ' + member.displayNick(true) + ' has quit ' + msg, 'action quit');
            } else if(options.type === 'kick') {
                this.addMsg(' ', '== ' + member.displayNick(true) + ' was kicked by ' + options.by + ' ' + msg, 'action kick');
            } else {
                this.addMsg(' ', '== ' + member.displayNick(true) + ' has left ' + msg, 'action part');
            }
        }, this);

        /*
        // Create an interface to the IRC netork
        this.network = _kiwi.global.components.Network();
        this.addNetworkEvents();
        */
    }

    /*
    addNetworkEvents: function () {
        var that = this;

        this.network.on('message:' + this.get('name'), function (event) {
            that.addMsg(event.nick, event.msg);
        });

        this.network.on('notice:' + this.get('name'), function (event) {
            that.addMsg('[' + (event.nick||'') + ']', event.msg);
        });

        this.network.on('action:' + this.get('name'), function (event) {
            that.addMsg('[' + (event.nick||'') + ']', event.msg);
        });
    }
    */
});


_kiwi.model.Server = _kiwi.model.Panel.extend({
    // Used to determine if this is a server panel
    server: true,

    initialize: function (attributes) {
        var name = "Server";
        this.view = new _kiwi.view.Panel({"model": this, "name": name});
        this.set({
            "scrollback": [],
            "name": name
        }, {"silent": true});

        //this.addMsg(' ', '--> Kiwi IRC: Such an awesome IRC client', '', {style: 'color:#009900;'});

        this.server_login = new _kiwi.view.ServerSelect();
        
        this.view.$el.append(this.server_login.$el);
        this.server_login.show();
    }
});


_kiwi.model.Applet = _kiwi.model.Panel.extend({
    // Used to determine if this is an applet panel. Applet panel tabs are treated
    // differently than others
    applet: true,


    initialize: function (attributes) {
        // Temporary name
        var name = "applet_"+(new Date().getTime().toString()) + Math.ceil(Math.random()*100).toString();
        this.view = new _kiwi.view.Applet({model: this, name: name});

        this.set({
            "name": name
        }, {"silent": true});

        // Holds the loaded applet
        this.loaded_applet = null;
    },


    // Load an applet within this panel
    load: function (applet_object, applet_name) {
        if (typeof applet_object === 'object') {
            // Make sure this is a valid Applet
            if (applet_object.get || applet_object.extend) {

                // Try find a title for the applet
                this.set('title', applet_object.get('title') || 'Unknown Applet');

                // Update the tabs title if the applet changes it
                applet_object.bind('change:title', function (obj, new_value) {
                    this.set('title', new_value);
                }, this);

                // If this applet has a UI, add it now
                this.view.$el.html('');
                if (applet_object.view) {
                    this.view.$el.append(applet_object.view.$el);
                }

                // Keep a reference to this applet
                this.loaded_applet = applet_object;

                this.loaded_applet.trigger('applet_loaded');
            }

        } else if (typeof applet_object === 'string') {
            // Treat this as a URL to an applet script and load it
            this.loadFromUrl(applet_object, applet_name);
        }

        return this;
    },


    loadFromUrl: function(applet_url, applet_name) {
        var that = this;

        this.view.$el.html('Loading..');
        $script(applet_url, function () {
            // Check if the applet loaded OK
            if (!_kiwi.applets[applet_name]) {
                that.view.$el.html('Not found');
                return;
            }

            // Load a new instance of this applet
            that.load(new _kiwi.applets[applet_name]());
        });
    },


    close: function () {
        this.view.$el.remove();
        this.destroy();
        
        this.view = undefined;

        // Call the applets dispose method if it has one
        if (this.loaded_applet && this.loaded_applet.dispose) {
            this.loaded_applet.dispose();
        }

        this.closePanel();
    }
},


{
    // Load an applet type once only. If it already exists, return that
    loadOnce: function (applet_name) {

        // See if we have an instance loaded already
        var applet = _.find(_kiwi.app.panels.models, function(panel) {
            // Ignore if it's not an applet
            if (!panel.isApplet()) return;

            // Ignore if it doesn't have an applet loaded
            if (!panel.loaded_applet) return;

            if (panel.loaded_applet.get('_applet_name') === applet_name) {
                return true;
            }
        });

        if (applet) return applet;


        // If we didn't find an instance, load a new one up
        return this.load(applet_name);
    },


    load: function (applet_name) {
        var applet;

        // Find the applet within the registered applets
        if (!_kiwi.applets[applet_name]) return;

        // Create the applet and load the content
        applet = new _kiwi.model.Applet();
        applet.load(new _kiwi.applets[applet_name]({_applet_name: applet_name}));

        // Add it into the tab list
        _kiwi.app.panels.add(applet);


        return applet;
    },


    register: function (applet_name, applet) {
        _kiwi.applets[applet_name] = applet;
    }
});


_kiwi.model.PluginManager = Backbone.Model.extend({
    initialize: function () {
        this.$plugin_holder = $('<div id="kiwi_plugins" style="display:none;"></div>').appendTo('#kiwi');
        this.loaded_plugins = {};
    },

    // Load an applet within this panel
    load: function (url) {
        if (this.loaded_plugins[url]) {
            this.unload(url);
        }

        this.loaded_plugins[url] = $('<div></div>');
        this.loaded_plugins[url].appendTo(this.$plugin_holder)
            .load(url);
    },


    unload: function (url) {
        if (!this.loaded_plugins[url]) {
            return;
        }

        this.loaded_plugins[url].remove();
        delete this.loaded_plugins[url];
    }
});


_kiwi.model.DataStore = Backbone.Model.extend({
	initialize: function () {
		this._namespace = '';
		this.new_data = {};
	},

	namespace: function (new_namespace) {
		if (new_namespace) this._namespace = new_namespace;
		return this._namespace;
	},

	// Overload the original save() method
	save: function () {
		localStorage.setItem(this._namespace, JSON.stringify(this.attributes));
	},

	// Overload the original load() method
	load: function () {
		if (!localStorage) return;

		var data;

		try {
			data = JSON.parse(localStorage.getItem(this._namespace)) || {};
		} catch (error) {
			data = {};
		}

		this.attributes = data;
	}
},

{
	// Generates a new instance of DataStore with a set namespace
	instance: function (namespace, attributes) {
		var datastore = new _kiwi.model.DataStore(attributes);
		datastore.namespace(namespace);
		return datastore;
	}
});


(function () {
    var View = Backbone.View.extend({
        events: {
            'click .save': 'saveSettings'
        },

        initialize: function (options) {
            this.$el = $($('#tmpl_applet_settings').html());

            // Incase any settings change while we have this open, update them
            _kiwi.global.settings.on('change', this.loadSettings, this);

            // Now actually show the current settings
            this.loadSettings();


        },
        

        loadSettings: function () {
            var settings = _kiwi.global.settings;

            // TODO: Tidy this up
            var theme = settings.get('theme') || 'relaxed';
            this.$el.find('.setting-theme option').filter(function() {
                return $(this).val() === theme;
            }).attr('selected', true);

            var list_style = settings.get('channel_list_style') || 'tabs';
            this.$el.find('.setting-channel_list_style option').filter(function() {
                return $(this).val() === list_style;
            }).attr('selected', true);

            this.$el.find('.setting-scrollback').val(settings.get('scrollback') || '250');

            if (typeof settings.get('show_joins_parts') === 'undefined' || settings.get('show_joins_parts')) {
                this.$el.find('.setting-show_joins_parts').attr('checked', true);
            } else {
                this.$el.find('.setting-show_joins_parts').attr('checked', false);
            }
        },


        saveSettings: function () {
            var settings = _kiwi.global.settings;

            // Stop settings being updated while we're saving one by one
            _kiwi.global.settings.off('change', this.loadSettings, this);

            settings.set('theme', $('.setting-theme', this.$el).val());
            settings.set('channel_list_style', $('.setting-channel_list_style', this.$el).val());
            settings.set('scrollback', $('.setting-scrollback', this.$el).val());
            settings.set('show_joins_parts', $('.setting-show_joins_parts', this.$el).is(':checked'));

            settings.save();

            // Continue listening for setting changes
            _kiwi.global.settings.on('change', this.loadSettings, this);
        }
    });



    var Applet = Backbone.Model.extend({
        initialize: function () {
            this.set('title', 'Settings');
            this.view = new View();
        }
    });


    _kiwi.model.Applet.register('kiwi_settings', Applet);
})();


(function () {
    var View = Backbone.View.extend({
        events: {
            'click .save': 'saveSettings'
        },

        initialize: function (options) {
            this.$el = $($('#tmpl_applet_settings').html());
        },
        
        saveSettings: function () {
            var theme = $('.theme', this.$el).val(),
                containers = $('#panels > .panel_container');

            // Clear any current theme
            containers.removeClass(function (i, css) {
                return (css.match (/\btheme_\S+/g) || []).join(' ');
            });

            if (theme) containers.addClass('theme_' + theme);
        }
    });



    _kiwi.applets.nickserv = Backbone.Model.extend({
        initialize: function () {
            this.set('title', 'Nickserv Login');
            //this.view = new View();

            _kiwi.global.control.on('command:login', this.loginCommand, this);
        },

        loginCommand: function (event) {
            console.log('waheeyy');
        }
    });
})();


(function () {

    var View = Backbone.View.extend({
        events: {
        },



        initialize: function (options) {
            this.$el = $($('#tmpl_channel_list').html());

            this.channels = [];

            // Sort the table by num. users?
            this.ordered = false;

            // Waiting to add the table back into the DOM?
            this.waiting = false;
        },


        render: function () {
            var table = $('table', this.$el),
                tbody = table.children('tbody:first').detach();
            /*tbody.children().each(function (child) {
                var i, chan;
                child = $(child);
                chan = child.children('td:first').text();
                for (i = 0; i < chanList.length; i++) {
                    if (chanList[i].channel === chan) {
                        chanList[i].html = child.detach();
                        break;
                    }
                }
            });*/

            if (this.ordered) {
                this.channels.sort(function (a, b) {
                    return b.num_users - a.num_users;
                });
            }

            _.each(this.channels, function (chan) {
                tbody.append(chan.html);
            });
            table.append(tbody);
        }
    });




    _kiwi.applets.Chanlist = Backbone.Model.extend({
        initialize: function () {
            this.set('title', 'Channel List');
            this.view = new View();
        },


        addChannel: function (channels) {
            var that = this;

            if (!_.isArray(channels)) {
                channels = [channels];
            }
            _.each(channels, function (chan) {
                var html, channel;
                html = '<tr><td><a class="chan">' + _.escape(chan.channel) + '</a></td><td class="num_users" style="text-align: center;">' + chan.num_users + '</td><td style="padding-left: 2em;">' + formatIRCMsg(_.escape(chan.topic)) + '</td></tr>';
                chan.html = html;
                that.view.channels.push(chan);
            });

            if (!that.view.waiting) {
                that.view.waiting = true;
                _.defer(function () {
                    that.view.render();
                    that.view.waiting = false;
                });
            }
        },


        dispose: function () {
            this.view.channels = null;
            this.view.unbind();
            this.view.$el.html('');
            this.view.remove();
            this.view = null;
        }
    });


})();


    (function () {
        var view = Backbone.View.extend({
            events: {
                'click .btn_save': 'onSave'
            },

            initialize: function (options) {
                var that = this;
                this.$el = $($('#tmpl_script_editor').html());

                this.model.on('applet_loaded', function () {
                    that.$el.parent().css('height', '100%');
                    $script('https://d1n0x3qji82z53.cloudfront.net/src-min-noconflict/ace.js', function (){ that.createAce(); });
                });
            },


            createAce: function () {
                var editor_id = 'editor_' + Math.floor(Math.random()*10000000).toString();
                this.editor_id = editor_id;

                this.$el.find('.editor').attr('id', editor_id);

                this.editor = ace.edit(editor_id);
                this.editor.setTheme("ace/theme/monokai");
                this.editor.getSession().setMode("ace/mode/javascript");

                var script_content = _kiwi.global.settings.get('user_script') || '';
                this.editor.setValue(script_content);
            },


            onSave: function (event) {
                var script_content, user_fn;

                // Build the user script up with some pre-defined components
                script_content = 'var network = kiwi.components.Network();\n';
                script_content += 'var input = kiwi.components.ControlInput();\n';
                script_content += this.editor.getValue() + '\n';

                // Add a dispose method to the user script for cleaning up
                script_content += 'this._dispose = function(){ network.off(); if(this.dispose) this.dispose(); }';

                // Try to compile the user script
                try {
                    user_fn = new Function(script_content);

                    // Dispose any existing user script
                    if (_kiwi.user_script && _kiwi.user_script._dispose)
                        _kiwi.user_script._dispose();

                    // Create and run the new user script
                    _kiwi.user_script = new user_fn();

                } catch (err) {
                    this.setStatus('Script error. ' + err.toString());
                    return;
                }

                // If we're this far, no errors occured. Save the user script
                _kiwi.global.settings.set('user_script', this.editor.getValue());
                _kiwi.global.settings.save();

                this.setStatus('Your script has been saved and is now active :)');
            },


            setStatus: function (status_text) {
                var $status = this.$el.find('.toolbar .status');

                status_text = status_text || '';
                $status.slideUp('fast', function() {
                    $status.text(status_text);
                    $status.slideDown();
                });
            }
        });



        var applet = Backbone.Model.extend({
            initialize: function () {
                var that = this;

                this.set('title', 'Script Editor');
                this.view = new view({model: this})

            }
        });


        _kiwi.model.Applet.register('kiwi_script_editor', applet);
        //_kiwi.model.Applet.loadOnce('kiwi_script_editor');
    })();


/*jslint devel: true, browser: true, continue: true, sloppy: true, forin: true, plusplus: true, maxerr: 50, indent: 4, nomen: true, regexp: true*/
/*globals $, front, gateway, Utilityview */



/**
*   Suppresses console.log
*   @param  {Boolean}   debug   Whether to re-enable console.log or not
*/
function manageDebug(debug) {
    var log, consoleBackUp;
    if (window.console) {
        consoleBackUp = window.console.log;
        window.console.log = function () {
            if (debug) {
                consoleBackUp.apply(console, arguments);
            }
        };
    } else {
        log = window.opera ? window.opera.postError : alert;
        window.console = {};
        window.console.log = function (str) {
            if (debug) {
                log(str);
            }
        };
    }
}

/**
*   Generate a random string of given length
*   @param      {Number}    string_length   The length of the random string
*   @returns    {String}                    The random string
*/
function randomString(string_length) {
    var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz",
        randomstring = '',
        i,
        rnum;
    for (i = 0; i < string_length; i++) {
        rnum = Math.floor(Math.random() * chars.length);
        randomstring += chars.substring(rnum, rnum + 1);
    }
    return randomstring;
}

/**
*   String.trim shim
*/
if (typeof String.prototype.trim === 'undefined') {
    String.prototype.trim = function () {
        return this.replace(/^\s+|\s+$/g, "");
    };
}

/**
*   String.lpad shim
*   @param      {Number}    length      The length of padding
*   @param      {String}    characher   The character to pad with
*   @returns    {String}                The padded string
*/
if (typeof String.prototype.lpad === 'undefined') {
    String.prototype.lpad = function (length, character) {
        var padding = "",
            i;
        for (i = 0; i < length; i++) {
            padding += character;
        }
        return (padding + this).slice(-length);
    };
}


/**
*   Convert seconds into hours:minutes:seconds
*   @param      {Number}    secs    The number of seconds to converts
*   @returns    {Object}            An object representing the hours/minutes/second conversion of secs
*/
function secondsToTime(secs) {
    var hours, minutes, seconds, divisor_for_minutes, divisor_for_seconds, obj;
    hours = Math.floor(secs / (60 * 60));

    divisor_for_minutes = secs % (60 * 60);
    minutes = Math.floor(divisor_for_minutes / 60);

    divisor_for_seconds = divisor_for_minutes % 60;
    seconds = Math.ceil(divisor_for_seconds);

    obj = {
        "h": hours,
        "m": minutes,
        "s": seconds
    };
    return obj;
}






/* Command input Alias + re-writing */
function InputPreProcessor () {
    this.recursive_depth = 3;

    this.aliases = {};
    this.vars = {version: 1};

    // Current recursive depth
    var depth = 0;


    // Takes an array of words to process!
    this.processInput = function (input) {
        var words = input || [],
            alias = this.aliases[words[0]],
            alias_len,
            current_alias_word = '',
            compiled = [];

        // If an alias wasn't found, return the original input
        if (!alias) return input;

        // Split the alias up into useable words
        alias = alias.split(' ');
        alias_len = alias.length;

        // Iterate over each word and pop them into the final compiled array.
        // Any $ words are processed with the result ending into the compiled array.
        for (var i=0; i<alias_len; i++) {
            current_alias_word = alias[i];

            // Non $ word
            if (current_alias_word[0] !== '$') {
                compiled.push(current_alias_word);
                continue;
            }

            // Refering to an input word ($N)
            if (!isNaN(current_alias_word[1])) {
                var num = current_alias_word.match(/\$(\d+)(\+)?(\d+)?/);

                // Did we find anything or does the word it refers to non-existant?
                if (!num || !words[num[1]]) continue;
                
                if (num[2] === '+' && num[3]) {
                    // Add X number of words
                    compiled = compiled.concat(words.slice(parseInt(num[1], 10), parseInt(num[1], 10) + parseInt(num[3], 10)));
                } else if (num[2] === '+') {
                    // Add the remaining of the words
                    compiled = compiled.concat(words.slice(parseInt(num[1], 10)));
                } else {
                    // Add a single word
                    compiled.push(words[parseInt(num[1], 10)]);
                }

                continue;
            }


            // Refering to a variable
            if (typeof this.vars[current_alias_word.substr(1)] !== 'undefined') {

                // Get the variable
                compiled.push(this.vars[current_alias_word.substr(1)]);

                continue;
            }

        }

        return compiled;
    };


    this.process = function (input) {
        input = input || '';

        var words = input.split(' ');

        depth++;
        if (depth >= this.recursive_depth) {
            depth--;
            return input;
        }

        if (this.aliases[words[0]]) {
            words = this.processInput(words);
            
            if (this.aliases[words[0]]) {
                words = this.process(words.join(' ')).split(' ');
            }

        }

        depth--;
        return words.join(' ');
    };
}











/**
 * Convert HSL to RGB formatted colour
 */
function hsl2rgb(h, s, l) {
    var m1, m2, hue;
    var r, g, b
    s /=100;
    l /= 100;
    if (s == 0)
        r = g = b = (l * 255);
    else {
        function HueToRgb(m1, m2, hue) {
            var v;
            if (hue < 0)
                hue += 1;
            else if (hue > 1)
                hue -= 1;

            if (6 * hue < 1)
                v = m1 + (m2 - m1) * hue * 6;
            else if (2 * hue < 1)
                v = m2;
            else if (3 * hue < 2)
                v = m1 + (m2 - m1) * (2/3 - hue) * 6;
            else
                v = m1;

            return 255 * v;
        }
        if (l <= 0.5)
            m2 = l * (s + 1);
        else
            m2 = l + s - l * s;
        m1 = l * 2 - m2;
        hue = h / 360;
        r = HueToRgb(m1, m2, hue + 1/3);
        g = HueToRgb(m1, m2, hue);
        b = HueToRgb(m1, m2, hue - 1/3);
    }
    return [r,g,b];
}





/**
*   Formats a message. Adds bold, underline and colouring
*   @param      {String}    msg The message to format
*   @returns    {String}        The HTML formatted message
*/
function formatIRCMsg (msg) {
    var re, next;

    if ((!msg) || (typeof msg !== 'string')) {
        return '';
    }

    // bold
    if (msg.indexOf(String.fromCharCode(2)) !== -1) {
        next = '<b>';
        while (msg.indexOf(String.fromCharCode(2)) !== -1) {
            msg = msg.replace(String.fromCharCode(2), next);
            next = (next === '<b>') ? '</b>' : '<b>';
        }
        if (next === '</b>') {
            msg = msg + '</b>';
        }
    }

    // underline
    if (msg.indexOf(String.fromCharCode(31)) !== -1) {
        next = '<u>';
        while (msg.indexOf(String.fromCharCode(31)) !== -1) {
            msg = msg.replace(String.fromCharCode(31), next);
            next = (next === '<u>') ? '</u>' : '<u>';
        }
        if (next === '</u>') {
            msg = msg + '</u>';
        }
    }

    // colour
    /**
    *   @inner
    */
    msg = (function (msg) {
        var replace, colourMatch, col, i, match, to, endCol, fg, bg, str;
        replace = '';
        /**
        *   @inner
        */
        colourMatch = function (str) {
            var re = /^\x03([0-9][0-9]?)(,([0-9][0-9]?))?/;
            return re.exec(str);
        };
        /**
        *   @inner
        */
        col = function (num) {
            switch (parseInt(num, 10)) {
            case 0:
                return '#FFFFFF';
            case 1:
                return '#000000';
            case 2:
                return '#000080';
            case 3:
                return '#008000';
            case 4:
                return '#FF0000';
            case 5:
                return '#800040';
            case 6:
                return '#800080';
            case 7:
                return '#FF8040';
            case 8:
                return '#FFFF00';
            case 9:
                return '#80FF00';
            case 10:
                return '#008080';
            case 11:
                return '#00FFFF';
            case 12:
                return '#0000FF';
            case 13:
                return '#FF55FF';
            case 14:
                return '#808080';
            case 15:
                return '#C0C0C0';
            default:
                return null;
            }
        };
        if (msg.indexOf('\x03') !== -1) {
            i = msg.indexOf('\x03');
            replace = msg.substr(0, i);
            while (i < msg.length) {
                /**
                *   @inner
                */
                match = colourMatch(msg.substr(i, 6));
                if (match) {
                    //console.log(match);
                    // Next colour code
                    to = msg.indexOf('\x03', i + 1);
                    endCol = msg.indexOf(String.fromCharCode(15), i + 1);
                    if (endCol !== -1) {
                        if (to === -1) {
                            to = endCol;
                        } else {
                            to = ((to < endCol) ? to : endCol);
                        }
                    }
                    if (to === -1) {
                        to = msg.length;
                    }
                    //console.log(i, to);
                    fg = col(match[1]);
                    bg = col(match[3]);
                    str = msg.substring(i + 1 + match[1].length + ((bg !== null) ? match[2].length : 0), to);
                    //console.log(str);
                    replace += '<span style="' + ((fg !== null) ? 'color: ' + fg + '; ' : '') + ((bg !== null) ? 'background-color: ' + bg + ';' : '') + '">' + str + '</span>';
                    i = to;
                } else {
                    if ((msg[i] !== '\x03') && (msg[i] !== String.fromCharCode(15))) {
                        replace += msg[i];
                    }
                    i++;
                }
            }
            return replace;
        }
        return msg;
    }(msg));
    
    return msg;
}




function formatDate (d) {
    d = d || new Date();
    return d.toLocaleDateString() + ', ' + d.getHours().toString() + ':' + d.getMinutes().toString() + ':' + d.getSeconds().toString();
}








/*
    PLUGINS
    Each function in each object is looped through and ran. The resulting text
    is expected to be returned.
*/
var plugins = [
    {
        name: "images",
        onaddmsg: function (event, opts) {
            if (!event.msg) {
                return event;
            }

            event.msg = event.msg.replace(/^((https?\:\/\/|ftp\:\/\/)|(www\.))(\S+)(\w{2,4})(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?(\.jpg|\.jpeg|\.gif|\.bmp|\.png)$/gi, function (url) {
                // Don't let any future plugins change it (ie. html_safe plugins)
                event.event_bubbles = false;

                var img = '<img class="link_img_a" src="' + url + '" height="100%" width="100%" />';
                return '<a class="link_ext link_img" target="_blank" rel="nofollow" href="' + url + '" style="height:50px;width:50px;display:block">' + img + '<div class="tt box"></div></a>';
            });

            return event;
        }
    },

    {
        name: "html_safe",
        onaddmsg: function (event, opts) {
            event.msg = $('<div/>').text(event.msg).html();
            event.nick = $('<div/>').text(event.nick).html();

            return event;
        }
    },

    {
        name: "activity",
        onaddmsg: function (event, opts) {
            //if (_kiwi.front.cur_channel.name.toLowerCase() !== _kiwi.front.tabviews[event.tabview.toLowerCase()].name) {
            //    _kiwi.front.tabviews[event.tabview].activity();
            //}

            return event;
        }
    },

    {
        name: "highlight",
        onaddmsg: function (event, opts) {
            //var tab = Tabviews.getTab(event.tabview.toLowerCase());

            // If we have a highlight...
            //if (event.msg.toLowerCase().indexOf(_kiwi.gateway.nick.toLowerCase()) > -1) {
            //    if (Tabview.getCurrentTab() !== tab) {
            //        tab.highlight();
            //    }
            //    if (_kiwi.front.isChannel(tab.name)) {
            //        event.msg = '<span style="color:red;">' + event.msg + '</span>';
            //    }
            //}

            // If it's a PM, highlight
            //if (!_kiwi.front.isChannel(tab.name) && tab.name !== "server"
            //    && Tabview.getCurrentTab().name.toLowerCase() !== tab.name
            //) {
            //    tab.highlight();
            //}

            return event;
        }
    },



    {
        //Following method taken from: http://snipplr.com/view/13533/convert-text-urls-into-links/
        name: "linkify_plain",
        onaddmsg: function (event, opts) {
            if (!event.msg) {
                return event;
            }

            event.msg = event.msg.replace(/((https?\:\/\/|ftp\:\/\/)|(www\.))(\S+)(\w{2,4})(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/gi, function (url) {
                var nice;
                // If it's any of the supported images in the images plugin, skip it
                if (url.match(/(\.jpg|\.jpeg|\.gif|\.bmp|\.png)$/)) {
                    return url;
                }

                nice = url;
                if (url.match('^https?:\/\/')) {
                    //nice = nice.replace(/^https?:\/\//i,'')
                    nice = url; // Shutting up JSLint...
                } else {
                    url = 'http://' + url;
                }

                //return '<a class="link_ext" target="_blank" rel="nofollow" href="' + url + '">' + nice + '<div class="tt box"></div></a>';
                return '<a class="link_ext" target="_blank" rel="nofollow" href="' + url + '">' + nice + '</a>';
            });

            return event;
        }
    },

    {
        name: "lftobr",
        onaddmsg: function (event, opts) {
            if (!event.msg) {
                return event;
            }

            event.msg = event.msg.replace(/\n/gi, function (txt) {
                return '<br/>';
            });

            return event;
        }
    },


    /*
     * Disabled due to many websites closing kiwi with iframe busting
    {
        name: "inBrowser",
        oninit: function (event, opts) {
            $('#windows a.link_ext').live('mouseover', this.mouseover);
            $('#windows a.link_ext').live('mouseout', this.mouseout);
            $('#windows a.link_ext').live('click', this.mouseclick);
        },

        onunload: function (event, opts) {
            // TODO: make this work (remove all .link_ext_browser as created in mouseover())
            $('#windows a.link_ext').die('mouseover', this.mouseover);
            $('#windows a.link_ext').die('mouseout', this.mouseout);
            $('#windows a.link_ext').die('click', this.mouseclick);
        },



        mouseover: function (e) {
            var a = $(this),
                tt = $('.tt', a),
                tooltip;

            if (tt.text() === '') {
                tooltip = $('<a class="link_ext_browser">Open in _kiwi..</a>');
                tt.append(tooltip);
            }

            tt.css('top', -tt.outerHeight() + 'px');
            tt.css('left', (a.outerWidth() / 2) - (tt.outerWidth() / 2));
        },

        mouseout: function (e) {
            var a = $(this),
                tt = $('.tt', a);
        },

        mouseclick: function (e) {
            var a = $(this),
                t;

            switch (e.target.className) {
            case 'link_ext':
            case 'link_img_a':
                return true;
                //break;
            case 'link_ext_browser':
                t = new Utilityview('Browser');
                t.topic = a.attr('href');

                t.iframe = $('<iframe border="0" class="utility_view" src="" style="width:100%;height:100%;border:none;"></iframe>');
                t.iframe.attr('src', a.attr('href'));
                t.div.append(t.iframe);
                t.show();
                break;
            }
            return false;

        }
    },
    */

    {
        name: "nick_colour",
        onaddmsg: function (event, opts) {
            if (!event.msg) {
                return event;
            }

            //if (typeof _kiwi.front.tabviews[event.tabview].nick_colours === 'undefined') {
            //    _kiwi.front.tabviews[event.tabview].nick_colours = {};
            //}

            //if (typeof _kiwi.front.tabviews[event.tabview].nick_colours[event.nick] === 'undefined') {
            //    _kiwi.front.tabviews[event.tabview].nick_colours[event.nick] = this.randColour();
            //}

            //var c = _kiwi.front.tabviews[event.tabview].nick_colours[event.nick];
            var c = this.randColour();
            event.nick = '<span style="color:' + c + ';">' + event.nick + '</span>';

            return event;
        },



        randColour: function () {
            var h = this.rand(-250, 0),
                s = this.rand(30, 100),
                l = this.rand(20, 70);
            return 'hsl(' + h + ',' + s + '%,' + l + '%)';
        },


        rand: function (min, max) {
            return parseInt(Math.random() * (max - min + 1), 10) + min;
        }
    },

    {
        name: "kiwitest",
        oninit: function (event, opts) {
            console.log('registering namespace');
            $(gateway).bind("_kiwi.lol.browser", function (e, data) {
                console.log('YAY kiwitest');
                console.log(data);
            });
        }
    }
];








/**
*   @constructor
*   @param  {String}    data_namespace  The namespace for the data store
*/
_kiwi.dataStore = function (data_namespace) {
    var namespace = data_namespace;

    this.get = function (key) {
        return $.jStorage.get(data_namespace + '_' + key);
    };

    this.set = function (key, value) {
        return $.jStorage.set(data_namespace + '_' + key, value);
    };
};

_kiwi.data = new _kiwi.dataStore('kiwi');




/*
 * jQuery jStorage plugin 
 * https://github.com/andris9/jStorage/
 */
(function(f){if(!f||!(f.toJSON||Object.toJSON||window.JSON)){throw new Error("jQuery, MooTools or Prototype needs to be loaded before jStorage!")}var g={},d={jStorage:"{}"},h=null,j=0,l=f.toJSON||Object.toJSON||(window.JSON&&(JSON.encode||JSON.stringify)),e=f.evalJSON||(window.JSON&&(JSON.decode||JSON.parse))||function(m){return String(m).evalJSON()},i=false;_XMLService={isXML:function(n){var m=(n?n.ownerDocument||n:0).documentElement;return m?m.nodeName!=="HTML":false},encode:function(n){if(!this.isXML(n)){return false}try{return new XMLSerializer().serializeToString(n)}catch(m){try{return n.xml}catch(o){}}return false},decode:function(n){var m=("DOMParser" in window&&(new DOMParser()).parseFromString)||(window.ActiveXObject&&function(p){var q=new ActiveXObject("Microsoft.XMLDOM");q.async="false";q.loadXML(p);return q}),o;if(!m){return false}o=m.call("DOMParser" in window&&(new DOMParser())||window,n,"text/xml");return this.isXML(o)?o:false}};function k(){if("localStorage" in window){try{if(window.localStorage){d=window.localStorage;i="localStorage"}}catch(p){}}else{if("globalStorage" in window){try{if(window.globalStorage){d=window.globalStorage[window.location.hostname];i="globalStorage"}}catch(o){}}else{h=document.createElement("link");if(h.addBehavior){h.style.behavior="url(#default#userData)";document.getElementsByTagName("head")[0].appendChild(h);h.load("jStorage");var n="{}";try{n=h.getAttribute("jStorage")}catch(m){}d.jStorage=n;i="userDataBehavior"}else{h=null;return}}}b()}function b(){if(d.jStorage){try{g=e(String(d.jStorage))}catch(m){d.jStorage="{}"}}else{d.jStorage="{}"}j=d.jStorage?String(d.jStorage).length:0}function c(){try{d.jStorage=l(g);if(h){h.setAttribute("jStorage",d.jStorage);h.save("jStorage")}j=d.jStorage?String(d.jStorage).length:0}catch(m){}}function a(m){if(!m||(typeof m!="string"&&typeof m!="number")){throw new TypeError("Key name must be string or numeric")}return true}f.jStorage={version:"0.1.5.1",set:function(m,n){a(m);if(_XMLService.isXML(n)){n={_is_xml:true,xml:_XMLService.encode(n)}}g[m]=n;c();return n},get:function(m,n){a(m);if(m in g){if(g[m]&&typeof g[m]=="object"&&g[m]._is_xml&&g[m]._is_xml){return _XMLService.decode(g[m].xml)}else{return g[m]}}return typeof(n)=="undefined"?null:n},deleteKey:function(m){a(m);if(m in g){delete g[m];c();return true}return false},flush:function(){g={};c();return true},storageObj:function(){function m(){}m.prototype=g;return new m()},index:function(){var m=[],n;for(n in g){if(g.hasOwnProperty(n)){m.push(n)}}return m},storageSize:function(){return j},currentBackend:function(){return i},storageAvailable:function(){return !!i},reInit:function(){var m,o;if(h&&h.addBehavior){m=document.createElement("link");h.parentNode.replaceChild(m,h);h=m;h.style.behavior="url(#default#userData)";document.getElementsByTagName("head")[0].appendChild(h);h.load("jStorage");o="{}";try{o=h.getAttribute("jStorage")}catch(n){}d.jStorage=o;i="userDataBehavior"}b()}};k()})(window.jQuery||window.$);


/*jslint white:true, regexp: true, nomen: true, devel: true, undef: true, browser: true, continue: true, sloppy: true, forin: true, newcap: true, plusplus: true, maxerr: 50, indent: 4 */
/*global kiwi */

_kiwi.view.MemberList = Backbone.View.extend({
    tagName: "ul",
    events: {
        "click .nick": "nickClick"
    },
    initialize: function (options) {
        this.model.bind('all', this.render, this);
        $(this.el).appendTo('#memberlists');
    },
    render: function () {
        var $this = $(this.el);
        $this.empty();
        this.model.forEach(function (member) {
            var prefix_css_class = (member.get('modes') || []).join(' ');
            $('<li class="mode ' + prefix_css_class + '"><a class="nick"><span class="prefix">' + member.get("prefix") + '</span>' + member.get("nick") + '</a></li>')
                .appendTo($this)
                .data('member', member);
        });
    },
    nickClick: function (x) {
        var $target = $(x.currentTarget).parent('li'),
            member = $target.data('member'),
            userbox;
        
        // If the userbox already exists here, hide it
        if ($target.find('.userbox').length > 0) {
            $('.userbox', this.$el).remove();
            return;
        }

        userbox = new _kiwi.view.UserBox();
        userbox.member = member;

        // Remove any existing userboxes
        $('.userbox', this.$el).remove();

        $target.append(userbox.$el);
    },
    show: function () {
        $('#memberlists').children().removeClass('active');
        $(this.el).addClass('active');
    }
});



_kiwi.view.UserBox = Backbone.View.extend({
    events: {
        'click .query': 'queryClick',
        'click .info': 'infoClick',
        'click .slap': 'slapClick'
    },

    initialize: function () {
        this.$el = $($('#tmpl_userbox').html());
    },

    queryClick: function (event) {
        var panel = new _kiwi.model.Query({name: this.member.get('nick')});
        _kiwi.app.panels.add(panel);
        panel.view.show();
    },

    infoClick: function (event) {
        _kiwi.app.controlbox.processInput('/whois ' + this.member.get('nick'));
    },

    slapClick: function (event) {
        _kiwi.app.controlbox.processInput('/slap ' + this.member.get('nick'));
    }
});

_kiwi.view.NickChangeBox = Backbone.View.extend({
    events: {
        'submit': 'changeNick',
        'click .cancel': 'close'
    },
    
    initialize: function () {
        this.$el = $($('#tmpl_nickchange').html());
    },
    
    render: function () {
        // Add the UI component and give it focus
        _kiwi.app.controlbox.$el.prepend(this.$el);
        this.$el.find('input').focus();

        this.$el.css('bottom', _kiwi.app.controlbox.$el.outerHeight(true));
    },
    
    close: function () {
        this.$el.remove();

    },

    changeNick: function (event) {
        var that = this;
        _kiwi.gateway.changeNick(this.$el.find('input').val(), function (err, val) {
            that.close();
        });
        return false;
    }
});

_kiwi.view.ServerSelect = function () {
    // Are currently showing all the controlls or just a nick_change box?
    var state = 'all';

    var model = Backbone.View.extend({
        events: {
            'submit form': 'submitForm',
            'click .show_more': 'showMore',
            'change .have_pass input': 'showPass'
        },

        initialize: function () {
            var that = this;

            this.$el = $($('#tmpl_server_select').html());

            // Remove the 'more' link if the server has disabled server changing
            if (_kiwi.app.server_settings && _kiwi.app.server_settings.connection) {
                if (!_kiwi.app.server_settings.connection.allow_change) {
                    this.$el.find('.show_more').remove();
                    this.$el.addClass('single_server');
                }
            }


            _kiwi.gateway.bind('onconnect', this.networkConnected, this);
            _kiwi.gateway.bind('connecting', this.networkConnecting, this);

            _kiwi.gateway.bind('onirc_error', function (data) {
                $('button', this.$el).attr('disabled', null);

                if (data.error == 'nickname_in_use') {
                    this.setStatus('Nickname already taken');
                    this.show('nick_change');
                }

                if (data.error == 'password_mismatch') {
                    this.setStatus('Incorrect Password');
                    this.show('nick_change');
                    that.$el.find('.password').select();
                }
            }, this);
        },

        submitForm: function (event) {
            event.preventDefault();

            // Make sure a nick is chosen
            if (!$('input.nick', this.$el).val().trim()) {
                this.setStatus('Select a nickname first!');
                $('input.nick', this.$el).select();
                return;
            }

            if (state === 'nick_change') {
                this.submitNickChange(event);
            } else {
                this.submitLogin(event);
            }

            $('button', this.$el).attr('disabled', 1);
            return;
        },

        submitLogin: function (event) {
            // If submitting is disabled, don't do anything
            if ($('button', this.$el).attr('disabled')) return;
            
            var values = {
                nick: $('input.nick', this.$el).val(),
                server: $('input.server', this.$el).val(),
                port: $('input.port', this.$el).val(),
                ssl: $('input.ssl', this.$el).prop('checked'),
                password: $('input.password', this.$el).val(),
                channel: $('input.channel', this.$el).val(),
                channel_key: $('input.channel_key', this.$el).val()
            };

            this.trigger('server_connect', values);
        },

        submitNickChange: function (event) {
            _kiwi.gateway.changeNick($('input.nick', this.$el).val());
            this.networkConnecting();
        },

        showPass: function (event) {
            if (this.$el.find('tr.have_pass input').is(':checked')) {
                this.$el.find('tr.pass').show().find('input').focus();
            } else {
                this.$el.find('tr.pass').hide().find('input').val('');
            }
        },

        showMore: function (event) {
            $('.more', this.$el).slideDown('fast');
            $('input.server', this.$el).select();
        },

        populateFields: function (defaults) {
            var nick, server, port, channel, channel_key, ssl, password;

            defaults = defaults || {};

            nick = defaults.nick || '';
            server = defaults.server || '';
            port = defaults.port || 6667;
            ssl = defaults.ssl || 0;
            password = defaults.password || '';
            channel = defaults.channel || '';
            channel_key = defaults.channel_key || '';

            $('input.nick', this.$el).val(nick);
            $('input.server', this.$el).val(server);
            $('input.port', this.$el).val(port);
            $('input.ssl', this.$el).prop('checked', ssl);
            $('input.password', this.$el).val(password);
            $('input.channel', this.$el).val(channel);
            $('input.channel_key', this.$el).val(channel_key);
        },

        hide: function () {
            this.$el.slideUp();
        },

        show: function (new_state) {
            new_state = new_state || 'all';

            this.$el.show();

            if (new_state === 'all') {
                $('.show_more', this.$el).show();

            } else if (new_state === 'more') {
                $('.more', this.$el).slideDown('fast');

            } else if (new_state === 'nick_change') {
                $('.more', this.$el).hide();
                $('.show_more', this.$el).hide();
                $('input.nick', this.$el).select();
            }

            state = new_state;
        },

        setStatus: function (text, class_name) {
            $('.status', this.$el)
                .text(text)
                .attr('class', 'status')
                .addClass(class_name||'')
                .show();
        },
        clearStatus: function () {
            $('.status', this.$el).hide();
        },

        networkConnected: function (event) {
            this.setStatus('Connected :)', 'ok');
            $('form', this.$el).hide();
        },

        networkConnecting: function (event) {
            this.setStatus('Connecting..', 'ok');
        },

        showError: function (event) {
            this.setStatus('Error connecting', 'error');
            $('button', this.$el).attr('disabled', null);
            this.show();
        }
    });


    return new model(arguments);
};


_kiwi.view.Panel = Backbone.View.extend({
    tagName: "div",
    className: "messages",
    events: {
        "click .chan": "chanClick",
        'click .media .open': 'mediaClick',
        'mouseenter .msg .nick': 'msgEnter',
        'mouseleave .msg .nick': 'msgLeave'
    },

    initialize: function (options) {
        this.initializePanel(options);
    },

    initializePanel: function (options) {
        this.$el.css('display', 'none');
        options = options || {};

        // Containing element for this panel
        if (options.container) {
            this.$container = $(options.container);
        } else {
            this.$container = $('#panels .container1');
        }

        this.$el.appendTo(this.$container);

        this.alert_level = 0;

        this.model.bind('msg', this.newMsg, this);
        this.msg_count = 0;

        this.model.set({"view": this}, {"silent": true});
    },

    render: function () {
        var that = this;

        this.$el.empty();
        _.each(this.model.get('scrollback'), function (msg) {
            that.newMsg(msg);
        });
    },

    newMsg: function (msg) {
        var re, line_msg, $this = this.$el,
            nick_colour_hex, nick_hex, is_highlight, msg_css_classes = '';

        // Nick highlight detecting
        if ((new RegExp('\\b' + _kiwi.gateway.get('nick') + '\\b', 'i')).test(msg.msg)) {
            is_highlight = true;
            msg_css_classes += ' highlight';
        }

        // Escape any HTML that may be in here
        msg.msg =  $('<div />').text(msg.msg).html();

        // Make the channels clickable
        re = new RegExp('(?:^|\\s)([' + _kiwi.gateway.get('channel_prefix') + '][^ ,.\\007]+)', 'g');
        msg.msg = msg.msg.replace(re, function (match) {
            return '<a class="chan" data-channel="' + match.trim() + '">' + match + '</a>';
        });


        // Parse any links found
        msg.msg = msg.msg.replace(/(([A-Za-z0-9\-]+\:\/\/)|(www\.))([\w.\-]+)([a-zA-Z]{2,6})(:[0-9]+)?(\/[\w#!:.?$'()[\]*,;~+=&%@!\-\/]*)?/gi, function (url) {
            var nice = url,
                extra_html = '';

            // Add the http if no protoocol was found
            if (url.match(/^www\./)) {
                url = 'http://' + url;
            }

            // Shorten the displayed URL if it's going to be too long
            if (nice.length > 100) {
                nice = nice.substr(0, 100) + '...';
            }

            // Get any media HTML if supported
            extra_html = _kiwi.view.MediaMessage.buildHtml(url);

            // Make the link clickable
            return '<a class="link_ext" target="_blank" rel="nofollow" href="' + url + '">' + nice + '</a> ' + extra_html;
        });


        // Convert IRC formatting into HTML formatting
        msg.msg = formatIRCMsg(msg.msg);


        // Add some colours to the nick (Method based on IRSSIs nickcolor.pl)
        nick_colour_hex = (function (nick) {
            var nick_int = 0, rgb;

            _.map(nick.split(''), function (i) { nick_int += i.charCodeAt(0); });
            rgb = hsl2rgb(nick_int % 255, 70, 35);
            rgb = rgb[2] | (rgb[1] << 8) | (rgb[0] << 16);

            return '#' + rgb.toString(16);
        })(msg.nick);

        msg.nick_style = 'color:' + nick_colour_hex + ';';

        // Generate a hex string from the nick to be used as a CSS class name
        nick_hex = msg.nick_css_class = '';
        if (msg.nick) {
            _.map(msg.nick.split(''), function (char) {
                nick_hex += char.charCodeAt(0).toString(16);
            });
            msg_css_classes += ' nick_' + nick_hex;
        }

        // Build up and add the line
        msg.msg_css_classes = msg_css_classes;
        line_msg = '<div class="msg <%= type %> <%= msg_css_classes %>"><div class="time"><%- time %></div><div class="nick" style="<%= nick_style %>"><%- nick %></div><div class="text" style="<%= style %>"><%= msg %> </div></div>';
        $this.append(_.template(line_msg, msg));

        // Activity/alerts based on the type of new message
        if (msg.type.match(/^action /)) {
            this.alert('action');

        } else if (is_highlight) {
            _kiwi.app.view.alertWindow('* People are talking!');
            this.alert('highlight');

        } else {
            // If this is the active panel, send an alert out
            if (this.model.isActive()) {
                _kiwi.app.view.alertWindow('* People are talking!');
            }
            this.alert('activity');
        }

        // Update the activity counters
        (function () {
            // Only inrement the counters if we're not the active panel
            if (this.model.isActive()) return;

            var $act = this.model.tab.find('.activity');
            $act.text((parseInt($act.text(), 10) || 0) + 1);
            if ($act.text() === '0') {
                $act.addClass('zero');
            } else {
                $act.removeClass('zero');
            }
        }).apply(this);

        this.scrollToBottom();

        // Make sure our DOM isn't getting too large (Acts as scrollback)
        this.msg_count++;
        if (this.msg_count > (parseInt(_kiwi.global.settings.get('scrollback'), 10) || 250)) {
            $('.msg:first', this.$el).remove();
            this.msg_count--;
        }
    },
    chanClick: function (event) {
        if (event.target) {
            _kiwi.gateway.join($(event.target).data('channel'));
        } else {
            // IE...
            _kiwi.gateway.join($(event.srcElement).data('channel'));
        }
    },

    mediaClick: function (event) {
        var $media = $(event.target).parents('.media');
        var media_message;

        if ($media.data('media')) {
            media_message = $media.data('media');
        } else {
            media_message = new _kiwi.view.MediaMessage({el: $media[0]});
            $media.data('media', media_message);
        }

        $media.data('media', media_message);

        media_message.open();
    },

    // Cursor hovers over a message
    msgEnter: function (event) {
        var nick_class;

        // Find a valid class that this element has
        _.each($(event.currentTarget).parent('.msg').attr('class').split(' '), function (css_class) {
            if (css_class.match(/^nick_[a-z0-9]+/i)) {
                nick_class = css_class;
            }
        });

        // If no class was found..
        if (!nick_class) return;

        $('.'+nick_class).addClass('global_nick_highlight');
    },

    // Cursor leaves message
    msgLeave: function (event) {
        var nick_class;

        // Find a valid class that this element has
        _.each($(event.currentTarget).parent('.msg').attr('class').split(' '), function (css_class) {
            if (css_class.match(/^nick_[a-z0-9]+/i)) {
                nick_class = css_class;
            }
        });

        // If no class was found..
        if (!nick_class) return;

        $('.'+nick_class).removeClass('global_nick_highlight');
    },

    show: function () {
        var $this = this.$el;

        // Hide all other panels and show this one
        this.$container.children().css('display', 'none');
        $this.css('display', 'block');

        // Show this panels memberlist
        var members = this.model.get("members");
        if (members) {
            $('#memberlists').removeClass('disabled');
            members.view.show();
        } else {
            // Memberlist not found for this panel, hide any active ones
            $('#memberlists').addClass('disabled').children().removeClass('active');
        }

        _kiwi.app.view.doLayout();

        // Remove any alerts and activity counters for this panel
        this.alert('none');
        this.model.tab.find('.activity').text('0').addClass('zero');

        this.trigger('active', this.model);
        _kiwi.app.panels.trigger('active', this.model, _kiwi.app.panels.active);

        this.scrollToBottom(true);
    },


    alert: function (level) {
        // No need to highlight if this si the active panel
        if (this.model == _kiwi.app.panels.active) return;

        var types, type_idx;
        types = ['none', 'action', 'activity', 'highlight'];

        // Default alert level
        level = level || 'none';

        // If this alert level does not exist, assume clearing current level
        type_idx = _.indexOf(types, level);
        if (!type_idx) {
            level = 'none';
            type_idx = 0;
        }

        // Only 'upgrade' the alert. Never down (unless clearing)
        if (type_idx !== 0 && type_idx <= this.alert_level) {
            return;
        }

        // Clear any existing levels
        this.model.tab.removeClass(function (i, css) {
            return (css.match(/\balert_\S+/g) || []).join(' ');
        });

        // Add the new level if there is one
        if (level !== 'none') {
            this.model.tab.addClass('alert_' + level);
        }

        this.alert_level = type_idx;
    },


    // Scroll to the bottom of the panel
    scrollToBottom: function (force_down) {
        // If this isn't the active panel, don't scroll
        if (this.model !== _kiwi.app.panels.active) return;

        // Don't scroll down if we're scrolled up the panel a little
        if (force_down || this.$container.scrollTop() + this.$container.height() > this.$el.outerHeight() - 150) {
            this.$container[0].scrollTop = this.$container[0].scrollHeight;
        }
    }
});

_kiwi.view.Applet = _kiwi.view.Panel.extend({
    className: 'applet',
    initialize: function (options) {
        this.initializePanel(options);
    }
});

_kiwi.view.Channel = _kiwi.view.Panel.extend({
    initialize: function (options) {
        this.initializePanel(options);
        this.model.bind('change:topic', this.topic, this);

        // Only show the loader if this is a channel (ie. not a query)
        if (this.model.isChannel()) {
            this.$el.append('<div class="initial_loader" style="margin:1em;text-align:center;">Joining channel.. <span class="loader"></span></div>');
        }
    },

    // Override the existing newMsg() method to remove the joining channel loader
    newMsg: function () {
        this.$el.find('.initial_loader').slideUp(function () {
            $(this).remove();
        });

        return this.constructor.__super__.newMsg.apply(this, arguments);
    },

    topic: function (topic) {
        if (typeof topic !== 'string' || !topic) {
            topic = this.model.get("topic");
        }
        
        this.model.addMsg('', '== Topic for ' + this.model.get('name') + ' is: ' + topic, 'topic');

        // If this is the active channel then update the topic bar
        if (_kiwi.app.panels.active === this) {
            _kiwi.app.topicbar.setCurrentTopic(this.model.get("topic"));
        }
    }
});

// Model for this = _kiwi.model.PanelList
_kiwi.view.Tabs = Backbone.View.extend({
    events: {
        'click li': 'tabClick',
        'click li .part': 'partClick'
    },

    initialize: function () {
        this.model.on("add", this.panelAdded, this);
        this.model.on("remove", this.panelRemoved, this);
        this.model.on("reset", this.render, this);

        this.model.on('active', this.panelActive, this);

        this.tabs_applets = $('ul.applets', this.$el);
        this.tabs_msg = $('ul.channels', this.$el);

        _kiwi.gateway.on('change:name', function (gateway, new_val) {
            $('span', this.model.server.tab).text(new_val);
        }, this);
    },
    render: function () {
        var that = this;

        this.tabs_msg.empty();
        
        // Add the server tab first
        this.model.server.tab
            .data('panel_id', this.model.server.cid)
            .appendTo(this.tabs_msg);

        // Go through each panel adding its tab
        this.model.forEach(function (panel) {
            // If this is the server panel, ignore as it's already added
            if (panel == that.model.server) return;

            panel.tab
                .data('panel_id', panel.cid)
                .appendTo(panel.isApplet() ? this.tabs_applets : this.tabs_msg);
        });

        _kiwi.app.view.doLayout();
    },

    updateTabTitle: function (panel, new_title) {
        $('span', panel.tab).text(new_title);
    },

    panelAdded: function (panel) {
        // Add a tab to the panel
        panel.tab = $('<li><span>' + (panel.get('title') || panel.get('name')) + '</span><div class="activity"></div></li>');

        if (panel.isServer()) {
            panel.tab.addClass('server');
        }

        panel.tab.data('panel_id', panel.cid)
            .appendTo(panel.isApplet() ? this.tabs_applets : this.tabs_msg);

        panel.bind('change:title', this.updateTabTitle);
        _kiwi.app.view.doLayout();
    },
    panelRemoved: function (panel) {
        panel.tab.remove();
        delete panel.tab;

        _kiwi.app.view.doLayout();
    },

    panelActive: function (panel, previously_active_panel) {
        // Remove any existing tabs or part images
        $('.part', this.$el).remove();
        this.tabs_applets.children().removeClass('active');
        this.tabs_msg.children().removeClass('active');

        panel.tab.addClass('active');

        // Only show the part image on non-server tabs
        if (!panel.isServer()) {
            panel.tab.append('<span class="part"></span>');
        }
    },

    tabClick: function (e) {
        var tab = $(e.currentTarget);

        var panel = this.model.getByCid(tab.data('panel_id'));
        if (!panel) {
            // A panel wasn't found for this tab... wadda fuck
            return;
        }

        panel.view.show();
    },

    partClick: function (e) {
        var tab = $(e.currentTarget).parent();
        var panel = this.model.getByCid(tab.data('panel_id'));

        // Only need to part if it's a channel
        // If the nicklist is empty, we haven't joined the channel as yet
        if (panel.isChannel() && panel.get('members').models.length > 0) {
            _kiwi.gateway.part(panel.get('name'));
        } else {
            panel.close();
        }
    },

    next: function () {
        var next = _kiwi.app.panels.active.tab.next();
        if (!next.length) next = $('li:first', this.tabs_msgs);

        next.click();
    },
    prev: function () {
        var prev = _kiwi.app.panels.active.tab.prev();
        if (!prev.length) prev = $('li:last', this.tabs_msgs);

        prev.click();
    }
});



_kiwi.view.TopicBar = Backbone.View.extend({
    events: {
        'keydown div': 'process'
    },

    initialize: function () {
        _kiwi.app.panels.bind('active', function (active_panel) {
            // If it's a channel topic, update and make editable
            if (active_panel.isChannel()) {
                this.setCurrentTopic(active_panel.get('topic') || '');
                this.$el.find('div').attr('contentEditable', true);

            } else {
                // Not a channel topic.. clear and make uneditable
                this.$el.find('div').attr('contentEditable', false)
                    .text('');
            }
        }, this);
    },

    process: function (ev) {
        var inp = $(ev.currentTarget),
            inp_val = inp.text();
        
        // Only allow topic editing if this is a channel panel
        if (!_kiwi.app.panels.active.isChannel()) {
            return false;
        }

        // If hit return key, update the current topic
        if (ev.keyCode === 13) {
            _kiwi.gateway.topic(_kiwi.app.panels.active.get('name'), inp_val);
            return false;
        }
    },

    setCurrentTopic: function (new_topic) {
        new_topic = new_topic || '';

        // We only want a plain text version
        $('div', this.$el).html(formatIRCMsg(_.escape(new_topic)));
    }
});



_kiwi.view.ControlBox = Backbone.View.extend({
    events: {
        'keydown .inp': 'process',
        'click .nick': 'showNickChange'
    },

    initialize: function () {
        var that = this;

        this.buffer = [];  // Stores previously run commands
        this.buffer_pos = 0;  // The current position in the buffer

        this.preprocessor = new InputPreProcessor();
        this.preprocessor.recursive_depth = 5;

        // Hold tab autocomplete data
        this.tabcomplete = {active: false, data: [], prefix: ''};

        _kiwi.gateway.bind('change:nick', function () {
            $('.nick', that.$el).text(this.get('nick'));
        });
    },

    showNickChange: function (ev) {
        (new _kiwi.view.NickChangeBox()).render();
    },

    process: function (ev) {
        var that = this,
            inp = $(ev.currentTarget),
            inp_val = inp.val(),
            meta;

        if (navigator.appVersion.indexOf("Mac") !== -1) {
            meta = ev.metaKey;
        } else {
            meta = ev.altKey;
        }

        // If not a tab key, reset the tabcomplete data
        if (this.tabcomplete.active && ev.keyCode !== 9) {
            this.tabcomplete.active = false;
            this.tabcomplete.data = [];
            this.tabcomplete.prefix = '';
        }
        
        switch (true) {
        case (ev.keyCode === 13):              // return
            inp_val = inp_val.trim();

            if (inp_val) {
                $.each(inp_val.split('\n'), function (idx, line) {
                    that.processInput(line);
                });

                this.buffer.push(inp_val);
                this.buffer_pos = this.buffer.length;
            }

            inp.val('');
            return false;

            break;

        case (ev.keyCode === 38):              // up
            if (this.buffer_pos > 0) {
                this.buffer_pos--;
                inp.val(this.buffer[this.buffer_pos]);
            }
            break;

        case (ev.keyCode === 40):              // down
            if (this.buffer_pos < this.buffer.length) {
                this.buffer_pos++;
                inp.val(this.buffer[this.buffer_pos]);
            }
            break;

        case (ev.keyCode === 219 && meta):            // [ + meta
            _kiwi.app.panels.view.prev();
            return false;

        case (ev.keyCode === 221 && meta):            // ] + meta
            _kiwi.app.panels.view.next();
            return false;

        case (ev.keyCode === 9):                     // tab
            this.tabcomplete.active = true;
            if (_.isEqual(this.tabcomplete.data, [])) {
                // Get possible autocompletions
                var ac_data = [];
                $.each(_kiwi.app.panels.active.get('members').models, function (i, member) {
                    if (!member) return;
                    ac_data.push(member.get('nick'));
                });
                ac_data = _.sortBy(ac_data, function (nick) {
                    return nick;
                });
                this.tabcomplete.data = ac_data;
            }

            if (inp_val[inp[0].selectionStart - 1] === ' ') {
                return false;
            }
            
            (function () {
                var tokens = inp_val.substring(0, inp[0].selectionStart).split(' '),
                    val,
                    p1,
                    newnick,
                    range,
                    nick = tokens[tokens.length - 1];
                if (this.tabcomplete.prefix === '') {
                    this.tabcomplete.prefix = nick;
                }

                this.tabcomplete.data = _.select(this.tabcomplete.data, function (n) {
                    return (n.toLowerCase().indexOf(that.tabcomplete.prefix.toLowerCase()) === 0);
                });

                if (this.tabcomplete.data.length > 0) {
                    p1 = inp[0].selectionStart - (nick.length);
                    val = inp_val.substr(0, p1);
                    newnick = this.tabcomplete.data.shift();
                    this.tabcomplete.data.push(newnick);
                    val += newnick;
                    val += inp_val.substr(inp[0].selectionStart);
                    inp.val(val);

                    if (inp[0].setSelectionRange) {
                        inp[0].setSelectionRange(p1 + newnick.length, p1 + newnick.length);
                    } else if (inp[0].createTextRange) { // not sure if this bit is actually needed....
                        range = inp[0].createTextRange();
                        range.collapse(true);
                        range.moveEnd('character', p1 + newnick.length);
                        range.moveStart('character', p1 + newnick.length);
                        range.select();
                    }
                }
            }).apply(this);
            return false;
        }
    },


    processInput: function (command_raw) {
        var command, params,
            pre_processed;
        
        // The default command
        if (command_raw[0] !== '/' || command_raw.substr(0, 2) === '//') {
            // Remove any slash escaping at the start (ie. //)
            command_raw = command_raw.replace(/^\/\//, '/');

            // Prepend the default command
            command_raw = '/msg ' + _kiwi.app.panels.active.get('name') + ' ' + command_raw;
        }

        // Process the raw command for any aliases
        this.preprocessor.vars.server = _kiwi.gateway.get('name');
        this.preprocessor.vars.channel = _kiwi.app.panels.active.get('name');
        this.preprocessor.vars.destination = this.preprocessor.vars.channel;
        command_raw = this.preprocessor.process(command_raw);

        // Extract the command and parameters
        params = command_raw.split(' ');
        if (params[0][0] === '/') {
            command = params[0].substr(1).toLowerCase();
            params = params.splice(1, params.length - 1);
        } else {
            // Default command
            command = 'msg';
            params.unshift(_kiwi.app.panels.active.get('name'));
        }

        // Trigger the command events
        this.trigger('command', {command: command, params: params});
        this.trigger('command:' + command, {command: command, params: params});

        // If we didn't have any listeners for this event, fire a special case
        // TODO: This feels dirty. Should this really be done..?
        if (!this._callbacks['command:' + command]) {
            this.trigger('unknown_command', {command: command, params: params});
        }
    }
});




_kiwi.view.StatusMessage = Backbone.View.extend({
    initialize: function () {
        this.$el.hide();

        // Timer for hiding the message after X seconds
        this.tmr = null;
    },

    text: function (text, opt) {
        // Defaults
        opt = opt || {};
        opt.type = opt.type || '';
        opt.timeout = opt.timeout || 5000;

        this.$el.text(text).attr('class', opt.type);
        this.$el.slideDown(_kiwi.app.view.doLayout);

        if (opt.timeout) this.doTimeout(opt.timeout);
    },

    html: function (html, opt) {
        // Defaults
        opt = opt || {};
        opt.type = opt.type || '';
        opt.timeout = opt.timeout || 5000;

        this.$el.html(text).attr('class', opt.type);
        this.$el.slideDown(_kiwi.app.view.doLayout);

        if (opt.timeout) this.doTimeout(opt.timeout);
    },

    hide: function () {
        this.$el.slideUp(_kiwi.app.view.doLayout);
    },

    doTimeout: function (length) {
        if (this.tmr) clearTimeout(this.tmr);
        var that = this;
        this.tmr = setTimeout(function () { that.hide(); }, length);
    }
});




_kiwi.view.ResizeHandler = Backbone.View.extend({
    events: {
        'mousedown': 'startDrag',
        'mouseup': 'stopDrag'
    },

    initialize: function () {
        this.dragging = false;
        this.starting_width = {};

        $(window).on('mousemove', $.proxy(this.onDrag, this));
    },

    startDrag: function (event) {
        this.dragging = true;
    },

    stopDrag: function (event) {
        this.dragging = false;
    },

    onDrag: function (event) {
        if (!this.dragging) return;

        this.$el.css('left', event.clientX - (this.$el.outerWidth(true) / 2));
        $('#memberlists').css('width', this.$el.parent().width() - (this.$el.position().left + this.$el.outerWidth()));
        _kiwi.app.view.doLayout();
    }
});



_kiwi.view.AppToolbar = Backbone.View.extend({
    events: {
        'click .settings': 'clickSettings'
    },

    initialize: function () {
    },

    clickSettings: function (event) {
        _kiwi.app.controlbox.processInput('/settings');
    }
});



_kiwi.view.Application = Backbone.View.extend({
    initialize: function () {
        $(window).resize(this.doLayout);
        $('#toolbar').resize(this.doLayout);
        $('#controlbox').resize(this.doLayout);

        // Change the theme when the config is changed
        _kiwi.global.settings.on('change:theme', this.updateTheme, this);
        this.updateTheme(getQueryVariable('theme'));

        _kiwi.global.settings.on('change:channel_list_style', this.setTabLayout, this);
        this.setTabLayout(_kiwi.global.settings.get('channel_list_style'));

        this.doLayout();

        $(document).keydown(this.setKeyFocus);

        // Confirmation require to leave the page
        window.onbeforeunload = function () {
            if (_kiwi.gateway.isConnected()) {
                return 'This will close all KiwiIRC conversations. Are you sure you want to close this window?';
            }
        };
    },



    updateTheme: function (theme_name) {
        // If called by the settings callback, get the correct new_value
        if (theme_name === _kiwi.global.settings) {
            theme_name = arguments[1];
        }

        // If we have no theme specified, get it from the settings
        if (!theme_name) theme_name = _kiwi.global.settings.get('theme');

        // Clear any current theme
        this.$el.removeClass(function (i, css) {
            return (css.match(/\btheme_\S+/g) || []).join(' ');
        });

        // Apply the new theme
        this.$el.addClass('theme_' + (theme_name || 'relaxed'));
    },


    setTabLayout: function (layout_style) {
        // If called by the settings callback, get the correct new_value
        if (layout_style === _kiwi.global.settings) {
            layout_style = arguments[1];
        }
        
        if (layout_style == 'list') {
            this.$el.addClass('chanlist_treeview');
        } else {
            this.$el.removeClass('chanlist_treeview');
        }
        
        this.doLayout();
    },


    // Globally shift focus to the command input box on a keypress
    setKeyFocus: function (ev) {
        // If we're copying text, don't shift focus
        if (ev.ctrlKey || ev.altKey || ev.metaKey) {
            return;
        }

        // If we're typing into an input box somewhere, ignore
        if ((ev.target.tagName.toLowerCase() === 'input') || (ev.target.tagName.toLowerCase() === 'textarea') || $(ev.target).attr('contenteditable')) {
            return;
        }

        $('#controlbox .inp').focus();
    },


    doLayout: function () {
        var el_kiwi = $('#kiwi');
        var el_panels = $('#panels');
        var el_memberlists = $('#memberlists');
        var el_toolbar = $('#toolbar');
        var el_controlbox = $('#controlbox');
        var el_resize_handle = $('#memberlists_resize_handle');

        var css_heights = {
            top: el_toolbar.outerHeight(true),
            bottom: el_controlbox.outerHeight(true)
        };


        // If any elements are not visible, full size the panals instead
        if (!el_toolbar.is(':visible')) {
            css_heights.top = 0;
        }

        if (!el_controlbox.is(':visible')) {
            css_heights.bottom = 0;
        }

        // Apply the CSS sizes
        el_panels.css(css_heights);
        el_memberlists.css(css_heights);
        el_resize_handle.css(css_heights);

        // If we have channel tabs on the side, adjust the height
        if (el_kiwi.hasClass('chanlist_treeview')) {
            $('#kiwi #tabs').css(css_heights);
        }

        // Determine if we have a narrow window (mobile/tablet/or even small desktop window)
        if (el_kiwi.outerWidth() < 400) {
            el_kiwi.addClass('narrow');
        } else {
            el_kiwi.removeClass('narrow');
        }

        // Set the panels width depending on the memberlist visibility
        if (el_memberlists.css('display') != 'none') {
            // Panels to the side of the memberlist
            el_panels.css('right', el_memberlists.outerWidth(true));
            // The resize handle sits overlapping the panels and memberlist
            el_resize_handle.css('left', el_memberlists.position().left - (el_resize_handle.outerWidth(true) / 2));
        } else {
            // Memberlist is hidden so panels to the right edge
            el_panels.css('right', 0);
            // And move the handle just out of sight to the right
            el_resize_handle.css('left', el_panels.outerWidth(true));
        }
    },


    alertWindow: function (title) {
        if (!this.alertWindowTimer) {
            this.alertWindowTimer = new (function () {
                var that = this;
                var tmr;
                var has_focus = true;
                var state = 0;
                var default_title = 'Kiwi IRC';
                var title = 'Kiwi IRC';

                this.setTitle = function (new_title) {
                    new_title = new_title || default_title;
                    window.document.title = new_title;
                    return new_title;
                };

                this.start = function (new_title) {
                    // Don't alert if we already have focus
                    if (has_focus) return;

                    title = new_title;
                    if (tmr) return;
                    tmr = setInterval(this.update, 1000);
                };

                this.stop = function () {
                    // Stop the timer and clear the title
                    if (tmr) clearInterval(tmr);
                    tmr = null;
                    this.setTitle();

                    // Some browsers don't always update the last title correctly
                    // Wait a few seconds and then reset
                    setTimeout(this.reset, 2000);
                };

                this.reset = function () {
                    if (tmr) return;
                    that.setTitle();
                };


                this.update = function () {
                    if (state === 0) {
                        that.setTitle(title);
                        state = 1;
                    } else {
                        that.setTitle();
                        state = 0;
                    }
                };

                $(window).focus(function (event) {
                    has_focus = true;
                    that.stop();

                    // Some browsers don't always update the last title correctly
                    // Wait a few seconds and then reset
                    setTimeout(that.reset, 2000);
                });

                $(window).blur(function (event) {
                    has_focus = false;
                });
            })();
        }

        this.alertWindowTimer.start(title);
    },


    barsHide: function (instant) {
        var that = this;

        if (!instant) {
            $('#toolbar').slideUp({queue: false, duration: 400, step: this.doLayout});
            $('#controlbox').slideUp({queue: false, duration: 400, step: this.doLayout});
        } else {
            $('#toolbar').slideUp(0);
            $('#controlbox').slideUp(0);
            this.doLayout();
        }
    },

    barsShow: function (instant) {
        var that = this;

        if (!instant) {
            $('#toolbar').slideDown({queue: false, duration: 400, step: this.doLayout});
            $('#controlbox').slideDown({queue: false, duration: 400, step: this.doLayout});
        } else {
            $('#toolbar').slideDown(0);
            $('#controlbox').slideDown(0);
            this.doLayout();
        }
    }
});









_kiwi.view.MediaMessage = Backbone.View.extend({
    events: {
        'click .media_close': 'close'
    },

    initialize: function () {
        // Get the URL from the data
        this.url = this.$el.data('url');
    },

    // Close the media content and remove it from display
    close: function () {
        var that = this;
        this.$content.slideUp('fast', function () {
            that.$content.remove();
        });
    },

    // Open the media content within its wrapper
    open: function () {
        // Create the content div if we haven't already
        if (!this.$content) {
            this.$content = $('<div class="media_content"><a class="media_close"><i class="icon-chevron-up"></i> Close media</a><br /><div class="content"></div></div>');
            this.$content.find('.content').append(this.mediaTypes[this.$el.data('type')].apply(this, []) || 'Not found :(');
        }

        // Now show the content if not already
        if (!this.$content.is(':visible')) {
            // Hide it first so the slideDown always plays
            this.$content.hide();

            // Add the media content and slide it into view
            this.$el.append(this.$content);
            this.$content.slideDown();
        }
    },



    // Generate the media content for each recognised type
    mediaTypes: {
        twitter: function () {
            var tweet_id = this.$el.data('tweetid');
            var that = this;

            $.getJSON('https://api.twitter.com/1/statuses/oembed.json?id=' + tweet_id + '&callback=?', function (data) {
                that.$content.find('.content').html(data.html);
            });

            return $('<div>Loading tweet..</div>');
        },


        image: function () {
            return $('<a href="' + this.url + '" target="_blank"><img height="100" src="' + this.url + '" /></a>');
        },


        reddit: function () {
            var that = this;
            var matches = (/reddit\.com\/r\/([a-zA-Z0-9_\-]+)\/comments\/([a-z0-9]+)\/([^\/]+)?/gi).exec(this.url);

            $.getJSON('http://www.' + matches[0] + '.json?jsonp=?', function (data) {
                console.log('Loaded reddit data', data);
                var post = data[0].data.children[0].data;
                var thumb = '';

                // Show a thumbnail if there is one
                if (post.thumbnail) {
                    //post.thumbnail = 'http://www.eurotunnel.com/uploadedImages/commercial/back-steps-icon-arrow.png';

                    // Hide the thumbnail if an over_18 image
                    if (post.over_18) {
                        thumb = '<span class="thumbnail_nsfw" onclick="$(this).find(\'p\').remove(); $(this).find(\'img\').css(\'visibility\', \'visible\');">';
                        thumb += '<p style="font-size:0.9em;line-height:1.2em;cursor:pointer;">Show<br />NSFW</p>';
                        thumb += '<img src="' + post.thumbnail + '" class="thumbnail" style="visibility:hidden;" />';
                        thumb += '</span>';
                    } else {
                        thumb = '<img src="' + post.thumbnail + '" class="thumbnail" />';
                    }
                }

                // Build the template string up
                var tmpl = '<div>' + thumb + '<b><%- title %></b><br />Posted by <%- author %>. &nbsp;&nbsp; ';
                tmpl += '<i class="icon-arrow-up"></i> <%- ups %> &nbsp;&nbsp; <i class="icon-arrow-down"></i> <%- downs %><br />';
                tmpl += '<%- num_comments %> comments made. <a href="http://www.reddit.com<%- permalink %>">View post</a></div>';

                that.$content.find('.content').html(_.template(tmpl, post));
            });

            return $('<div>Loading Reddit thread..</div>');
        }
    }

}, {

    // Build the closed media HTML from a URL
    buildHtml: function (url) {
        var html = '', matches;

        // Is it an image?
        if (url.match(/(\.jpe?g|\.gif|\.bmp|\.png)\??$/i)) {
            html += '<span class="media image" data-type="image" data-url="' + url + '" title="Open Image"><a class="open"><i class="icon-chevron-right"></i></a></span>';
        }

        // Is it a tweet?
        matches = (/https?:\/\/twitter.com\/([a-zA-Z0-9_]+)\/status\/([0-9]+)/ig).exec(url);
        if (matches) {
            html += '<span class="media twitter" data-type="twitter" data-url="' + url + '" data-tweetid="' + matches[2] + '" title="Show tweet information"><a class="open"><i class="icon-chevron-right"></i></a></span>';
        }

        // Is reddit?
        matches = (/reddit\.com\/r\/([a-zA-Z0-9_\-]+)\/comments\/([a-z0-9]+)\/([^\/]+)?/gi).exec(url);
        if (matches) {
            html += '<span class="media reddit" data-type="reddit" data-url="' + url + '" title="Reddit thread"><a class="open"><i class="icon-chevron-right"></i></a></span>';
        }

        return html;
    }
});



})(window);