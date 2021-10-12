#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');
const jwt = require('jsonwebtoken');
const get = require('lodash/get');
const joystick = require('./joystick')

const generateAccessToken = function (payload, secret, expiration) {
    const token = jwt.sign(payload, secret, {
        expiresIn: expiration
    });

    return token;
};

// Get secret key from the config file and generate an access token
const getUserHome = function () {
    return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
};

module.exports = function (options, callback) {
    options = options || {};
    options.secret = get(options, 'secret', process.env['CNCJS_SECRET']);
    options.baudrate = get(options, 'baudrate', 115200);
    options.socketAddress = get(options, 'socketAddress', 'localhost');
    options.socketPort = get(options, 'socketPort', 8000);
    options.controllerType = get(options, 'controllerType', 'Grbl');
    options.accessTokenLifetime = get(options, 'accessTokenLifetime', '30d');

    if (!options.secret) {
        const cncrc = path.resolve(getUserHome(), '.cncrc');
        try {
            const config = JSON.parse(fs.readFileSync(cncrc, 'utf8'));
            options.secret = config.secret;
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    }

    const token = generateAccessToken({ id: '', name: 'cncjs-pendant' }, options.secret, options.accessTokenLifetime);
    const url = 'ws://' + options.socketAddress + ':' + options.socketPort + '?token=' + token;

    socket = io.connect('ws://' + options.socketAddress + ':' + options.socketPort, {
        'query': 'token=' + token
    });

    const JOG_CANCEL_CMD = '\x85';

    const SPINDLE_MIN_SPEED = 0;
    const SPINDLE_MAX_SPEED = 24000;

    const BUTTONS = {
        0: { id: 'A', cb: onA },
        1: { id: 'B', cb: onB },
        2: { id: '2', cb: onXXX },
        3: { id: 'X', cb: onX },
        4: { id: 'Y', cb: onY },
        5: { id: '5', cb: onXXX },
        6: { id: 'LB', cb: onLB },
        7: { id: 'RB', cb: onRB },
        8: { id: '8', cb: onXXX },
        9: { id: '9', cb: onXXX },
        10: { id: '10', cb: onXXX },
        11: { id: 'START', cb: onStart },
        12: { id: '12', cb: onXXX },
        13: { id: 'L3', cb: onL3 },
        14: { id: 'R3', cb: onR3 },
    };
    const AXES = {
        0: { id: 'LSX', cb: onLSX },
        1: { id: 'LSY', cb: onLSY },
        2: { id: 'RSX', cb: onRSX },
        3: { id: 'RSY', cb: onRSY },
        4: { id: 'RT', cb: onRT },
        5: { id: 'LT', cb: onLT },
        6: { id: 'PADX', cb: onPADX },
        7: { id: 'PADY', cb: onPADY },
    };

    const JOYSTICK_DEADZONE = 500;
    const JOYSTICK_SENSITIVITY = 100;
    const JOYSTICK_AXIS_MAX = 32767;
    const JOYSTICK_ID = 0;

    const joy = new joystick.Joystick(JOYSTICK_ID, JOYSTICK_DEADZONE, JOYSTICK_SENSITIVITY);

    var controller_connected = false;
    const reconnect_check_time = 3000;  // ms
    setInterval(function () { checkController(joy); }, reconnect_check_time);
    function checkController(joy) {
        if (!controller_connected) {
            joy.open()
        }
    }

    socket.on('connect', () => {
        console.log('CNC socket connected.');

        // Open port
        socket.emit('open', options.port, {
            baudrate: Number(options.baudrate),
            controllerType: options.controllerType
        });
    });

    socket.on('error', (err) => {
        console.error('CNC socket error: ' + err);
        if (socket) {
            socket.destroy();
            socket = null;
        }
    });

    socket.on('close', () => {
        console.log('CNC socket closed.');
    });

    socket.on('serialport:open', function (options) {
        options = options || {};

        console.log('Connected to port "' + options.port + '" (Baud rate: ' + options.baudrate + ')');

        callback(null, socket);
    });

    socket.on('serialport:error', function (options) {
        callback(new Error('Error opening serial port "' + options.port + '"'));
    });

    // Callbacks ----------------------------------

    joy.on('error', (err) => {
        console.log('Joystick error:', err);
        controller_connected = false;
    });

    joy.on('ready', () => {
        console.log('Joystick connected.');
        controller_connected = true;
    });

    joy.on('button', function (e) {
        console.log(BUTTONS[e.number].id, " ", e.value);
        BUTTONS[e.number].cb(e.value);
    });

    joy.on('axis', function (e) {
        //console.log(BUTTONS[e.number].id, " ", e.value);
        AXES[e.number].cb(e.value);
    });

    // Buttons ------------------------------------

    function onXXX(value) {
        console.log("Unknown button pressed: " + value);
    }

    var lb = false;
    function onLB(value) {
        lb = Boolean(value);
        if (!lb) {
            // Stop jog
            socket.emit('write', options.port, JOG_CANCEL_CMD);
        }

        if (!lb && spindle_active) {
            // Stop spindle
            socket.emit('command', options.port, 'gcode', 'M5');
            spindle_active = false;
        }
    };

    var rb = false;
    function onRB(value) {
        rb = Boolean(value);

        if (!rb && spindle_active) {
            // Stop spindle
            socket.emit('command', options.port, 'gcode', 'M5');
            spindle_active = false;
        }
    };

    function onStart(value) {
        if (value == 1) {
            if (!rb) {
                // Kill alarm
                socket.emit('command', options.port, 'unlock');
            } else {
                // Soft reset
                socket.emit('command', options.port, 'reset');
            }
        }
    };

    function onA(value) {
        if (value == 1) {
            if (!lb && !rb) {
                // Cycle start
                socket.emit('command', options.port, 'gcode:resume');
            } else if (lb) {
                // Deadman switch
                if (lb) {
                    dpad('Z', -1)
                }
            }
        }
    };

    function onB(value) {
        if (value == 1) {
            if (!rb) {
                // Feed hold
                socket.emit('command', options.port, 'gcode:pause');
            } else {
            }
        }
    };

    function onX(value) {
        if (value == 1) {
            if (!rb) {
            } else {
            }
        }
    };


    function onY(value) {
        if (value == 1) {
            if (!lb && !rb) {
            } else if (lb) {
                // Deadman switch
                if (lb) {
                    dpad('Z', 1)
                }
            } else if (rb) {
                // Home
                socket.emit('command', options.port, 'homing');
            }
        }
    };

    function onL3(value) {
        if (value == 1) {
        }
    };

    function onR3(value) {
        if (value == 1) {
        }
    };

    // D-Pad --------------------------------------

    function dpad(axis, direction) {
        socket.emit('command', options.port, 'gcode', '$J=G91G21'
            + axis + direction * step_distance
            + 'F' + jog_feedrate.toFixed(2));
    }

    const STEP_DISTANCES = [
        0.01,
        0.1,
        1.0,
        10.0
    ];

    var step_distance_selection = 2;
    var step_distance = STEP_DISTANCES[step_distance_selection];

    function onPADX(value) {
        // Deadman switch
        if (lb) {
            if (value == -JOYSTICK_AXIS_MAX) {
                dpad('X', -1)
            } else if (value == JOYSTICK_AXIS_MAX) {
                dpad('X', 1)
            }
        } else {
            if (value == -JOYSTICK_AXIS_MAX) {
                step_distance_selection = Math.max((step_distance_selection - 1), 0);
            } else if (value == JOYSTICK_AXIS_MAX) {
                step_distance_selection = Math.min((step_distance_selection + 1), STEP_DISTANCES.length - 1);
            }
            step_distance = STEP_DISTANCES[step_distance_selection];
        }
    }

    // Y
    function onPADY(value) {
        // Deadman switch
        if (lb) {
            if (value == -JOYSTICK_AXIS_MAX) {
                dpad('Y', -1)
            } else if (value == JOYSTICK_AXIS_MAX) {
                dpad('Y', 1)
            }
        }
    }

    // Trigger ------------------------------------

    // Left trigger
    var lt = 0;
    function onLT(value) {
        lt = value;
    };

    // Right trigger
    var rt = 0;
    function onRT(value) {
        rt = value;
    }

    function map(x, in_min, in_max, out_min, out_max) {
        return Number((x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min).toFixed(2);
    }

    // Set spindle speed based on right trigger
    var spindle_active = false;
    setInterval(triggerMovement, 5000);
    function triggerMovement() {
        // Double deadman switch
        if (lb && rb) {
            spindle_active = true;
            socket.emit('command', options.port, 'gcode', 'M3 S'
                + map(rt, -JOYSTICK_AXIS_MAX, JOYSTICK_AXIS_MAX, SPINDLE_MIN_SPEED, SPINDLE_MAX_SPEED));
        }
    };

    // Sticks ------------------------------------

    // Left stick
    var left_x = 0;
    function onLSX(value) {
        left_x = value;
    };

    var left_y = 0;
    function onLSY(value) {
        left_y = -value;
    };

    // Right stick
    var right_x = 0;
    function onRSX(value) {
        right_x = value;
    };

    var right_y = 0;
    function onRSY(value) {
        right_y = -value;
    };

    function map(x, in_range_half, out_range_half) {
        return Number((x + in_range_half) * out_range_half / in_range_half - out_range_half).toFixed(4);
    };

    var jog_distance = 3.3;
    var jog_feedrate = 1000;
    setInterval(stickMovement, 50);
    function stickMovement() {
        // Deadman switch
        if (lb) {
            if (left_x != 0 || left_y != 0 || right_y != 0) {
                socket.emit('command', options.port, 'gcode', '$J=G91G21'
                    + 'X' + map(left_x, JOYSTICK_AXIS_MAX, jog_distance)
                    + 'Y' + map(left_y, JOYSTICK_AXIS_MAX, jog_distance)
                    + 'Z' + map(right_y, JOYSTICK_AXIS_MAX, jog_distance)
                    + 'F' + jog_feedrate.toFixed(2));
            }
        }
    };
};
