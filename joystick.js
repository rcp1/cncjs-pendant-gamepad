/* Copyright (c) 2012, Jay Beavers
 * Modifications copyright (c) 2021, Robin Petereit
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * Redistributions of source code must retain the above copyright notice, this list
 * of conditions and the following disclaimer.
 *
 * Redistributions in binary form must reproduce the above copyright notice, this 
 * list of conditions and the following disclaimer in the documentation and/or 
 * other materials provided with the distribution.
 *
 * The name of the Jay Beavers may not be used to endorse or promote products 
 * derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND 
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED 
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR 
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES 
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; 
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON 
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT 
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS 
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
const fs = require('fs');
const events = require('events');
/*
 *  id is the file system index of the joystick (e.g. /dev/input/js0 has id '0')
 *
 *  deadzone is the amount of sensitivity at the center of the axis to ignore.
 *    Axis reads from -32k to +32k and empirical testing on an XBox360 controller
 *    shows that a good 'dead stick' value is 3500
 *  Note that this deadzone algorithm assumes that 'center is zero' which is not generally
 *    the case so you may want to set deadzone === 0 and instead perform some form of
 *    calibration.
 *
 *  sensitivity is the amount of change in an axis reading before an event will be emitted.
 *    Empirical testing on an XBox360 controller shows that sensitivity is around 350 to remove
 *    noise in the data
 */

class Joystick extends events {
  constructor(id, deadzone, sensitivity) {
    super();

    const buffer = new Buffer(8);
    let fd;

    // Last reading from this axis, used for debouncing events using sensitivty setting
    let lastAxisValue = [];
    let lastAxisEmittedValue = [];

    const parse = (buffer) => {
      const event = {
        time: buffer.readUInt32LE(0),
        value: buffer.readInt16LE(4),
        number: buffer[7]
      };

      const type = buffer[6];

      if (type & 0x80) {
        event.init = true;
      }

      if (type & 0x01) {
        event.type = 'button';
      }

      if (type & 0x02) {
        event.type = 'axis';
      }

      event.id = id;

      return event;
    };

    const startRead = () => {
      fs.read(fd, buffer, 0, 8, null, onRead);
    };

    const onOpen = (err, fdOpened) => {
      if (err) return this.emit('error', err);
      else {
        this.emit('ready');

        fd = fdOpened;
        startRead();
      }
    };

    const onRead = (err, bytesRead) => {
      if (err) return this.emit('error', err);
      const event = parse(buffer);

      let squelch = false;

      if (event.type === 'axis') {
        if (sensitivity) {
          if (lastAxisValue[event.number] && Math.abs(lastAxisValue[event.number] - event.value) < sensitivity && event.value != 0) {
            // data squelched due to sensitivity, no self.emit
            squelch = true;
          } else {
            lastAxisValue[event.number] = event.value;
          }
        }

        if (deadzone && Math.abs(event.value) < deadzone) event.value = 0;

        if (lastAxisEmittedValue[event.number] === event.value) {
          squelch = true;
        } else {
          lastAxisEmittedValue[event.number] = event.value;
        }
      }

      if (!squelch) this.emit(event.type, event);
      if (fd) startRead();
    };

    this.close = function (callback) {
      fs.close(fd, callback);
      fd = undefined;
    };

    this.open = function () {
      fs.open('/dev/input/js' + id, 'r', onOpen);
    }
  }
};

exports.Joystick = Joystick;