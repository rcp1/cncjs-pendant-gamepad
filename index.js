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

    class ButtonState {
        constructor(timeout, onShortPressed, onLongPressed, onLongCanceled) {
            this.pending = false;
            this.long_pressed = false;
            this.timeout = timeout;
            this.timeout_id = 0;
            this.onShortPressed = onShortPressed;
            this.onLongPressed = onLongPressed;
            this.onLongCanceled = onLongCanceled;
        }

        press() {
            if (!this.pending) {
                this.pending = true;
                this.timeout_id = setTimeout(this.onTimeout.bind(this), this.timeout);
            }
        }

        unpress() {
            if (this.pending) {
                this.pending = false;
                if (!this.long_pressed) {
                    clearTimeout(this.timeout_id);
                    this.onShortPressed();
                } else {
                    this.long_pressed = false;
                    this.onLongCanceled();
                }
            }
        }

        onTimeout() {
            this.long_pressed = true;
            this.onLongPressed();
        };
    }

    class AxisState {
        constructor() {
            this.value = 0;
            this.active = false;
        }

        update(value) {
            this.value = value;
            this.active = value != 0;
        }

        sign() {
            return Math.sign(this.value);
        }
    };

    class Selector {
        constructor(default_index, options) {
            this.index = Number(default_index);
            this.options = options;
        }

        increase() {
            this.index = Math.min(this.index + 1, this.options.length - 1);
        }

        decrease() {
            this.index = Math.max(this.index - 1, 0);
        }

        get() {
            return this.options[this.index];
        }

    };

    const JOG_CANCEL_CMD = '\x85';
    const JOG_BASE_CMD = '$J=G91G21';

    const SPINDLE_MIN_SPEED = 0;
    const SPINDLE_MAX_SPEED = 24000;
    const STEP_FEEDRATES = [
        100,
        500,
        1000,
        2000
    ];
    const STEP_DISTANCES = [
        0.01,
        0.1,
        1.0,
        10.0
    ];
    var step_distance_selection = new Selector(2, STEP_DISTANCES);
    var step_feedrate_selection = new Selector(2, STEP_FEEDRATES);
    const MAX_JOG_FEEDRATE = 3000;
    const JOG_COMMAND_INTERVAL = 100;
    const JOG_COMMAND_TIMEOUT = 1000;

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

    const JOYSTICK_DEADZONE = 750;
    const JOYSTICK_SENSITIVITY = 100;
    const JOYSTICK_AXIS_MAX = 32767;
    const JOYSTICK_ID = 0;
    const JOYSTICK_LONG_PRESS_TIMEOUT = 500;

    const joy = new joystick.Joystick(JOYSTICK_ID, JOYSTICK_DEADZONE, JOYSTICK_SENSITIVITY);

    var jog_pending = false;

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

    socket.on('serialport:read', function (data) {
        if (data.includes('ok') || data.includes('error')) {
            jog_pending = false;
            clearTimeout(jogPendingTimeout);
        } else {
            console.log('Unhandled response: ' + data)
        }
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
        if (e.init) {
            // Print available button functionality
            console.log(BUTTONS[e.number].id, " ", e.value);
        } else {
            BUTTONS[e.number].cb(e.value);
        }
    });

    joy.on('axis', function (e) {
        if (e.init) {
            // Print available axis functionality
            console.log(AXES[e.number].id, " ", e.value);
        } else {
            console.log(AXES[e.number].id, " ", e.value);
            AXES[e.number].cb(e.value);
        }
    });

    // Buttons ------------------------------------

    function onXXX(value) {
        console.log("Unknown pressed: " + value);
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

    var y_z_up = new ButtonState(JOYSTICK_LONG_PRESS_TIMEOUT, jogShort.bind(null, 'Z', 1),
        jogLong.bind(null, 'Z', 1), cancelJog);
    var a_z_down = new ButtonState(JOYSTICK_LONG_PRESS_TIMEOUT, jogShort.bind(null, 'Z', -1),
        jogLong.bind(null, 'Z', -1), cancelJog);
    function onA(value) {
        if (value == 1) {
            if (!lb && !rb) {
                // Cycle start
                socket.emit('command', options.port, 'gcode:resume');
            } else if (lb) {
                // Deadman switch
                if (lb) {
                    a_z_down.press()
                }
            }
        } else {
            a_z_down.unpress()
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
                // Nothing
            } else if (lb) {
                // Deadman switch
                if (lb) {
                    y_z_up.press()
                }
            } else if (rb) {
                // Home
                socket.emit('command', options.port, 'homing');
            }
        } else {
            y_z_up.unpress()
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
    function jogShort(axis, direction) {
        var cmd = '$J=G91G21'
            + axis + direction * step_distance_selection.get().toFixed(4)
            + 'F' + step_feedrate_selection.get().toFixed(2)
        jog(cmd);
    };

    function jogLong(axis, direction) {
        var cmd = '$J=G91G21'
            + axis + direction * 1000.0
            + 'F' + step_feedrate_selection.get().toFixed(2)
        jog(cmd);
    };

    function cancelJog() {
        // Stop jog
        socket.emit('write', options.port, JOG_CANCEL_CMD);
    }

    var pad_x_left = new ButtonState(JOYSTICK_LONG_PRESS_TIMEOUT, jogShort.bind(null, 'X', -1),
        jogLong.bind(null, 'X', -1), cancelJog);
    var pad_x_right = new ButtonState(JOYSTICK_LONG_PRESS_TIMEOUT, jogShort.bind(null, 'X', 1),
        jogLong.bind(null, 'X', 1), cancelJog);

    function onPADX(value) {
        // Deadman switch
        if (lb) {
            if (value == -JOYSTICK_AXIS_MAX) {
                pad_x_left.press();
            } else if (value == JOYSTICK_AXIS_MAX) {
                pad_x_right.press();
            } else {
                pad_x_left.unpress();
                pad_x_right.unpress();
            }
        } else {
            if (value == -JOYSTICK_AXIS_MAX) {
                step_distance_selection.decrease()
            } else if (value == JOYSTICK_AXIS_MAX) {
                step_distance_selection.increase()
            }
        }
    }

    var pad_y_up = new ButtonState(JOYSTICK_LONG_PRESS_TIMEOUT, jogShort.bind(null, 'Y', 1),
        jogLong.bind(null, 'Y', 1), cancelJog);
    var pad_y_down = new ButtonState(JOYSTICK_LONG_PRESS_TIMEOUT, jogShort.bind(null, 'Y', -1),
        jogLong.bind(null, 'Y', -1), cancelJog);

    function onPADY(value) {
        // Deadman switch
        if (lb) {
            if (value == -JOYSTICK_AXIS_MAX) {
                pad_y_up.press();
            } else if (value == JOYSTICK_AXIS_MAX) {
                pad_y_down.press();
            } else {
                pad_y_up.unpress();
                pad_y_down.unpress();
            }
        } else {
            if (value == -JOYSTICK_AXIS_MAX) {
                step_feedrate_selection.increase()
            } else if (value == JOYSTICK_AXIS_MAX) {
                step_feedrate_selection.decrease()
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
    var left_x = new AxisState();
    function onLSX(value) {
        left_x.update(value);
    };

    var left_y = new AxisState();
    function onLSY(value) {
        left_y.update(-value);
    };

    // Right stick
    var right_x = new AxisState();
    function onRSX(value) {
        right_x.update(value);
    };

    var right_y = new AxisState();
    function onRSY(value) {
        right_y.update(-value);
    };

    function map(x, in_range_half, out_range_half) {
        return Number((x + in_range_half) * out_range_half / in_range_half - out_range_half).toFixed(2);
    };

    function jog(cmd) {
        if (!jog_pending) {
            socket.emit('command', options.port, 'gcode', cmd);
            jog_pending = true;
            setTimeout(jogPendingTimeout, JOG_COMMAND_TIMEOUT);
        }
    }

    function jogPendingTimeout() {
        jog_pending = false;
    };

    setInterval(stickMovement, JOG_COMMAND_INTERVAL);
    function stickMovement() {
        // Deadman switch
        if (lb) {
            var x = left_x;
            var y = left_y;
            var z = right_y;
            if (x.active || y.active || z.active) {
                var jog_feedrate = decideFeedrate(x, y, z);
                var cmd = JOG_BASE_CMD
                    + motionVector(x, y, z, jog_feedrate)
                    + 'F' + jog_feedrate;
                jog(cmd);
            }
        }
    };

    function decideFeedrate(x, y, z) {
        // Jog feedrate is norm of xy vector
        var jog_feedrate = Math.sqrt(feedrate(x.value) ** 2 + feedrate(y.value) ** 2);
        // Jog feedrate can be overriden by lower z feedrate
        if (z.active) {
            var z_jog_feedrate = feedrate(z.value);
            jog_feedrate = jog_feedrate != 0 ? Math.min(jog_feedrate, z_jog_feedrate) : z_jog_feedrate;
        }

        return jog_feedrate;
    }

    function feedrate(value) {
        return Math.abs(map(value, JOYSTICK_AXIS_MAX, MAX_JOG_FEEDRATE));
    };

    function motionVector(x, y, z, jog_feedrate) {
        var jog_distance = jogDistance(jog_feedrate);
        var motion_vector_string = '';
        if (x.active) {
            motion_vector_string += "X";
            motion_vector_string += x.sign() * jog_distance;
        }
        if (y.active) {
            motion_vector_string += "Y";
            motion_vector_string += y.sign() * jog_distance;
        }
        if (z.active) {
            motion_vector_string += "Z";
            motion_vector_string += z.sign() * jog_distance;
        }

        return motion_vector_string;
    };

    function jogDistance(jog_feedrate) {
        // Calculate how long we should be able to move at the given interval + 20% acceleration time
        return ((jog_feedrate / 60.0) * (JOG_COMMAND_INTERVAL / 1000.0) * 1.2).toFixed(4);
    }

};
