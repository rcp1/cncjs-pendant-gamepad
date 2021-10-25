# cncjs-pendant-gamepad
A cncjs pendant for Linux joystick driver.

## Installation
```
npm install
```

## Usage
Run `bin/cncjs-pendant-gamepad` to start the interactive client. Pass --help to `cncjs-pendant-gamepad` for more options.

```
bin/cncjs-pendant-gamepad --help
```

## Buttons

* RS == Right Stick (X/Y)
* RSB == Right Stick Button
* LS == Left Stick (X/Y)
* LSB == Left Stick Button
* DPAD == Digital pad (X/Y)
* RB == Right Bumper
* RT == Right Trigger
* LB == Left Bumper
* LT == Left Trigger
* A == A Button (Bottom)
* B == B Button (Right)
* X == X Button (Left)
* Y == Y Button (Top)

<img src="doc/gamepad.png" alt="drawing" width="600"/>

## Mapping

* RS:
  * Y-Axis: Continuous jog y axis jog with variable feedrate (LB)
* RSB: TBD
* LS:
  * Y-Axis: Continuous jog y axis with variable feedrate (LB)
  * X-Axis: Continuous jog x axis with variable feedrate (LB)
* LSB: TBD
* DPAD:
  * Y-Axis: 
    * Short: Step jog y axis jog with fixed feedrate (LB)
    * Long: Continuous jog y axis jog with fixed feedrate (LB)
  * X-Axis:
    * Short: Step jog x axis jog with fixed feedrate (LB)
    * Long: Continuous jog x axis jog with fixed feedrate (LB)
* RB: Combo switch, needs to be pressed for alternative button functions
* RT: Activate spindle, trigger position defines spindle rpm (LB + RB)
* LB: Deadman switch, needs to be pressed for all jog / spindle commands
* LT: TBD
* A:
  * Cycle start
  * Short: Step jog z axis jog with fixed feedrate negative (LB)
  * Long: Continuous jog z axis jog with fixed feedrate negative (LB)
* B: Feed hold
* X: TBD
* Y:
  * Home (RB)
  * Short: Step jog z axis jog with fixed feedrate positive (LB)
  * Long: Continuous jog z axis jog with fixed feedrate positive (LB)
