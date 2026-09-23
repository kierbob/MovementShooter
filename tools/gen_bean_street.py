"""Generates maps/bean-street.json: a small two-houses-across-a-street FFA map built for movement.

The map is point-symmetric (x, z) -> (-x, -z), so both halves play the same.
Movement routes (checked with tools/check_bean_street.mjs):
  - backyard launch ramp -> through the big upstairs back window
  - wall-jump chimney between the border wall and a billboard -> billboard top (boomstick to the roof)
  - bus bridge: ramp up, run the roof, slide down the far ramp for speed
  - street-end overlooks with ramps (long sightline down the street)
  - huge front windows: fly between the two houses' upper floors
Run:  python tools/gen_bean_street.py
"""
import json
import math
import os

boxes, pads, spawns = [], [], []


def box(x0, x1, z0, z1, y0, y1, kind, ramp=None):
    """Box from min/max corners. ramp: 'x+', 'x-', 'z+', 'z-' = rises toward that side."""
    x0, x1 = sorted((x0, x1))
    z0, z1 = sorted((z0, z1))
    b = {
        'x': round((x0 + x1) / 2, 3), 'z': round((z0 + z1) / 2, 3),
        'w': round(x1 - x0, 3), 'd': round(z1 - z0, 3),
        'h': round(y1 - y0, 3), 'y': round(y0, 3), 'kind': kind,
    }
    if ramp:
        b['ramp'] = ramp
    boxes.append(b)


def wall(axis, fixed, a0, a1, y0, y1, holes, kind, t=0.4):
    """A wall along `axis` ('x' or 'z') at `fixed` (its center line), spanning a0..a1 and y0..y1,
    with rectangular holes [(h0, h1, hy0, hy1)] for doors and windows (holes may stack vertically)."""
    cuts = sorted({a0, a1, *[h[0] for h in holes], *[h[1] for h in holes]})
    for s0, s1 in zip(cuts, cuts[1:]):
        if s1 - s0 < 1e-6:
            continue
        mid = (s0 + s1) / 2
        span = sorted([(h[2], h[3]) for h in holes if h[0] <= mid <= h[1]])
        y = y0
        for hy0, hy1 in span + [(y1, y1)]:
            if hy0 - y > 1e-6:
                if axis == 'x':
                    box(s0, s1, fixed - t / 2, fixed + t / 2, y, hy0, kind)
                else:
                    box(fixed - t / 2, fixed + t / 2, s0, s1, y, hy0, kind)
            y = max(y, hy1)


GROUND = 2.9      # underside of the upper floor
UP = 3.2          # upper floor walking height
TOP = 6.2         # top of the outer walls
DOOR = 2.5
WIN_LO = (0.8, 2.6)       # downstairs windows (crouch-jump through)
WIN_HI = (3.4, 6.0)       # upstairs windows: low sill, big enough to fly through standing
X0, X1 = -24, -12         # house footprint (front faces the street at x = -12)
Z0, Z1 = -8, 8
LAUNCH_H = 1.8            # backyard launch ramp height


def west_half(house, trim):
    lo, hi = WIN_LO, WIN_HI
    # Front (street side): door, wide windows, near glass-front upstairs.
    wall('z', X1, Z0, Z1, 0, TOP, [
        (-1.2, 1.2, 0, DOOR),
        (-7, -2.5, *lo), (2.5, 7, *lo),
        (-7, -1, *hi), (1, 7, *hi),
    ], house)
    # Back (yard side): back door, window, and a huge upstairs window the launch ramp aims at.
    wall('z', X0, Z0, Z1, 0, TOP, [
        (-6, -4, 0, DOOR),
        (-2, 2, *lo),
        (-6.5, 6.5, *hi),
    ], house)
    # Sides.
    wall('x', Z0, X0 + 0.2, X1 - 0.2, 0, TOP, [
        (-20, -18, 0, DOOR),
        (-16.5, -13.5, *lo),
        (-22.5, -13.5, *hi),
    ], house)
    wall('x', Z1, X0 + 0.2, X1 - 0.2, 0, TOP, [
        (-22, -14.5, *lo),
        (-22.5, -13.5, *hi),
    ], house)

    # Upper floor over the south part; the north part is a double-height room with the ramp.
    box(X0 + 0.2, X1 - 0.2, Z0 + 0.2, 2.8, GROUND, UP, 'wall')
    # Ramp up to the upper floor (rises toward the back of the house), railing gap at the top.
    box(-18.5, -13.5, 2.8, 4.8, 0, UP, 'stair', 'x-')
    box(X0 + 0.2, -19.2, 2.6, 2.8, UP, UP + 1.0, trim)
    box(-17.2, X1 - 0.2, 2.6, 2.8, UP, UP + 1.0, trim)
    # Downstairs: kitchen divider with a doorway, counter, sofa.
    wall('z', -18, Z0 + 0.2, 2.8, 0, GROUND, [(-3.5, -1.5, 0, DOOR)], house, t=0.3)
    box(-16.5, -14, -6.5, -5.5, 0, 1.0, trim)
    box(-22.5, -20.5, 5, 7, 0, 0.8, trim)
    # Upstairs furniture (hop cover).
    box(-23.4, -21, -7.4, -5, UP, UP + 0.7, trim)
    box(-15, -13, -7.4, -6.6, UP, UP + 2.0, trim)
    # Roof (walkable).
    box(X0 - 0.3, X1 + 0.3, Z0 - 0.3, Z1 + 0.3, TOP, TOP + 0.3, 'wall')

    # Front yard: fences at the ends only, so the windows stay open to the street. Porch step.
    box(-10.7, -10.5, -15, -9, 0, 1.0, 'low')
    box(-10.7, -10.5, 9, 15, 0, 1.0, 'low')
    box(-12, -11, -1.5, 1.5, 0, 0.3, trim)
    # Car (hop over) and a box truck you can ramp onto.
    box(-8.5, -6.5, -14, -9.6, 0, 1.4, 'low')
    box(-8.2, -6.8, -13.2, -10.6, 1.4, 2.1, 'low')
    box(-7.2, -4.8, 12, 18, 0, 3.0, 'plat')            # truck box
    box(-7.2, -4.8, 10.2, 12, 0, 2.2, 'plat')          # cab
    box(-7.2, -4.8, 6.2, 10.2, 0, 2.2, 'stair', 'z+')  # ramp onto the cab

    # Backyard.
    box(-34, -29, -1.5, 1.5, 0, LAUNCH_H, 'stair', 'x+')   # launch ramp -> upstairs back window
    box(-33, -29, -17, -13, 0, 2.8, 'pillar')             # shed
    box(-33, -29, -13, -9, 0, 2.8, 'stair', 'z-')          # ramp onto the shed
    box(-34, -33, 12, 22, 0, 6.0, 'block')                # billboard: wall-jump chimney with the border
    pads.append({'x': -26.5, 'y': 0, 'z': 6.5, 'radius': 1.2, 'launch': 20})  # onto the roof

    # Side paths.
    box(-20, -17, -21, -19.5, 0, 1.2, 'low')   # barrier
    box(-15, -13, 20, 22, 0, 1.6, 'block')     # dumpster

    # Spawns (the mirror adds the other six), all facing the middle.
    for (x, z) in [(-32, -21), (-32.5, -5), (-30, 9), (-20, -23), (-20, 23), (-4, -23)]:
        spawns.append({'x': x, 'y': 0, 'z': z, 'yaw': round(math.atan2(x, z), 3)})


west_half('test', 'stair')
west_count = (len(boxes), len(pads), len(spawns))

FLIP = {'x+': 'x-', 'x-': 'x+', 'z+': 'z-', 'z-': 'z+'}


def mirror(o):
    m = dict(o)
    m['x'] = round(-o['x'], 3)
    m['z'] = round(-o['z'], 3)
    if 'yaw' in o:
        m['yaw'] = round(math.atan2(m['x'], m['z']), 3)
    if 'ramp' in o:
        m['ramp'] = FLIP[o['ramp']]
    return m


recolor = {'test': 'plat', 'plat': 'test'}  # the east house gets its own colors
boxes += [dict(mirror(b), kind=recolor.get(b['kind'], b['kind'])) for b in boxes[:west_count[0]]]
pads += [mirror(p) for p in pads[:west_count[1]]]
spawns += [mirror(s) for s in spawns[:west_count[2]]]

# ---------- shared middle ----------
box(-1.3, 1.3, -5.5, 5.5, 0, 2.6, 'low')           # the bus
box(-1.3, 1.3, 5.5, 10, 0, 2.6, 'stair', 'z-')     # bus ramps (a bridge over the street)
box(-1.3, 1.3, -10, -5.5, 0, 2.6, 'stair', 'z+')
box(-6, 6, -21.5, -21, 0, 1.1, 'low')              # street-end barriers
box(-6, 6, 21, 21.5, 0, 1.1, 'low')
box(-8, 8, -27, -24.5, 0, 3.2, 'block')            # overlooks down the street
box(8, 13, -27, -24.5, 0, 3.2, 'stair', 'x-')
box(-8, 8, 24.5, 27, 0, 3.2, 'block')
box(-13, -8, 24.5, 27, 0, 3.2, 'stair', 'x+')

# ---------- ground + boundary ----------
HX, HZ = 37, 27
box(-HX, HX, -HZ, HZ, -1, 0, 'floor')
box(-HX - 1, HX + 1, -HZ - 1, -HZ, 0, 9, 'wall')
box(-HX - 1, HX + 1, HZ, HZ + 1, 0, 9, 'wall')
box(-HX - 1, -HX, -HZ, HZ, 0, 9, 'wall')
box(HX, HX + 1, -HZ, HZ, 0, 9, 'wall')

# Test Play starts at the first spawn: put a street-side one first.
spawns.sort(key=lambda s: abs(s['x']))

out = {'name': 'Bean Street', 'version': 2, 'boxes': boxes, 'pads': pads, 'spawns': spawns}
path = os.path.join(os.path.dirname(__file__), '..', 'maps', 'bean-street.json')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, indent=1)
print(f'{len(boxes)} boxes, {len(pads)} pads, {len(spawns)} spawns -> {os.path.normpath(path)}')
