"""Generates maps/bean-street.json: a small two-houses-across-a-street FFA map.

The map is point-symmetric (x, z) -> (-x, -z), so both halves play the same.
Run:  python tools/gen_bean_street.py
"""
import json
import math
import os

boxes, pads, spawns = [], [], []


def box(x0, x1, z0, z1, y0, y1, kind):
    """Box from min/max corners (easier to reason about than center + size)."""
    x0, x1 = sorted((x0, x1))
    z0, z1 = sorted((z0, z1))
    boxes.append({
        'x': round((x0 + x1) / 2, 3), 'z': round((z0 + z1) / 2, 3),
        'w': round(x1 - x0, 3), 'd': round(z1 - z0, 3),
        'h': round(y1 - y0, 3), 'y': round(y0, 3), 'kind': kind,
    })


def wall(axis, fixed, a0, a1, y0, y1, holes, kind, t=0.4):
    """A wall along `axis` ('x' or 'z') at `fixed` (its center line), spanning a0..a1 and y0..y1,
    with rectangular holes [(h0, h1, hy0, hy1)] for doors and windows."""
    cuts = sorted({a0, a1, *[h[0] for h in holes], *[h[1] for h in holes]})
    for s0, s1 in zip(cuts, cuts[1:]):
        if s1 - s0 < 1e-6:
            continue
        mid = (s0 + s1) / 2
        hole = next((h for h in holes if h[0] <= mid <= h[1]), None)
        pieces = [(y0, y1)] if not hole else [(y0, hole[2]), (hole[3], y1)]
        for p0, p1 in pieces:
            if p1 - p0 < 1e-6:
                continue
            if axis == 'x':
                box(s0, s1, fixed - t / 2, fixed + t / 2, p0, p1, kind)
            else:
                box(fixed - t / 2, fixed + t / 2, s0, s1, p0, p1, kind)


# ---------- one half (west). The east half is the point mirror. ----------
GROUND = 2.9      # underside of the upper floor
UP = 3.2          # upper floor walking height
TOP = 6.2         # top of the outer walls
DOOR = 2.4        # door height
X0, X1 = -24, -12  # house footprint (front faces the street at x = -12)
Z0, Z1 = -8, 8


def west_half(house, trim):
    # Outer walls. Front (street side): door, two windows downstairs, two windows upstairs.
    wall('z', X1, Z0, Z1, 0, TOP, [
        (-1, 1, 0, DOOR),
        (-6.5, -3, 1.0, 2.2), (3, 6.5, 1.0, 2.2),
        (-6.5, -2, UP + 1.0, UP + 2.2), (2, 6.5, UP + 1.0, UP + 2.2),
    ], house)
    # Back (yard side): back door (clear of the stairs) + windows.
    wall('z', X0, Z0, Z1, 0, TOP, [
        (-6, -4, 0, DOOR),
        (-2, 1.5, 1.0, 2.2),
        (-5, 5, UP + 1.0, UP + 2.2),
    ], house)
    # Sides (walls run along x; trimmed so corners don't overlap the front/back walls).
    wall('x', Z0, X0 + 0.2, X1 - 0.2, 0, TOP, [
        (-20, -18, 0, DOOR),                 # side door toward the south path
        (-16, -14, 1.0, 2.2),
        (-21, -15, UP + 1.0, UP + 2.2),
    ], house)
    wall('x', Z1, X0 + 0.2, X1 - 0.2, 0, TOP, [
        (-21, -15, 1.0, 2.2),
        (-20, -15, UP + 1.0, UP + 2.2),
    ], house)

    # Upper floor over the south part; the north part is a double-height room with the stairs.
    box(X0 + 0.2, X1 - 0.2, Z0 + 0.2, 2.8, GROUND, UP, 'wall')
    # Stairs along the upper floor's edge, rising toward the back of the house (0.4 m steps);
    # from the top step you walk onto the upper floor through a gap in the railing.
    for i in range(8):
        x_hi = -13.5 - i * 0.625
        box(x_hi - 0.625, x_hi, 2.8, 4.8, 0, 0.4 * (i + 1), 'stair')
    box(X0 + 0.2, -19.2, 2.6, 2.8, UP, UP + 1.0, trim)      # railing, back part
    box(-17.2, X1 - 0.2, 2.6, 2.8, UP, UP + 1.0, trim)      # railing over the stairs
    # Downstairs: kitchen divider with a doorway, and a counter.
    wall('z', -18, Z0 + 0.2, 2.8, 0, GROUND, [(-3.5, -1.5, 0, DOOR)], house, t=0.3)
    box(-16.5, -14, -6.5, -5.5, 0, 1.0, trim)   # kitchen counter
    box(-22.5, -20.5, 4, 6, 0, 0.8, trim)      # sofa (hop cover in the big room)
    # Upstairs furniture.
    box(-23.4, -21, -7.4, -5, UP, UP + 0.7, trim)   # bed
    box(-15, -13, -7.4, -6.6, UP, UP + 2.0, trim)   # wardrobe
    # Roof (walkable if you get up there).
    box(X0 - 0.3, X1 + 0.3, Z0 - 0.3, Z1 + 0.3, TOP, TOP + 0.3, 'wall')

    # Front yard: low fence with a gap at the path, porch step.
    box(-10.7, -10.5, -15, -2, 0, 1.0, 'low')
    box(-10.7, -10.5, 2, 15, 0, 1.0, 'low')
    box(-12, -11, -1.5, 1.5, 0, 0.3, trim)      # porch step
    # Car and truck on this side of the street.
    box(-8.5, -6.5, -14, -9.6, 0, 1.4, 'low')      # car
    box(-8.2, -6.8, -13.2, -10.6, 1.4, 2.1, 'low')  # car cabin
    box(-7.2, -4.8, 12, 18, 0, 3.0, 'plat')        # box truck
    box(-7.2, -4.8, 10.2, 12, 0, 2.2, 'plat')      # truck cab

    # Backyard: shed, planter wall, playground-ish climb.
    box(-33, -29, -17, -13, 0, 2.8, 'pillar')     # shed
    box(-34, -26, 12.5, 13, 0, 1.2, 'low')        # planter wall
    box(-31, -29, 16, 18, 0, 1.0, 'block')        # crates to hop up
    box(-33, -31, 18, 20, 0, 2.0, 'block')
    pads.append({'x': -26.5, 'y': 0, 'z': 2, 'radius': 1.2, 'launch': 20})  # onto the roof

    # Side path clutter.
    box(-20, -17, -21, -19.5, 0, 1.2, 'low')   # barrier
    box(-15, -13, 20, 22, 0, 1.6, 'block')     # dumpster

    # Spawns (the mirror adds the other six), all facing the middle.
    for (x, z) in [(-32, -20), (-33, -5), (-32, 8), (-20, -23), (-20, 23), (-6, -23)]:
        spawns.append({'x': x, 'y': 0, 'z': z, 'yaw': round(math.atan2(x, z), 3)})


west_half('test', 'stair')
west_count = (len(boxes), len(pads), len(spawns))


def mirror(o):
    m = dict(o)
    m['x'] = round(-o['x'], 3)
    m['z'] = round(-o['z'], 3)
    if 'yaw' in o:
        m['yaw'] = round(math.atan2(m['x'], m['z']), 3)
    return m


# East house gets its own colors.
recolor = {'test': 'plat', 'plat': 'test'}
boxes += [dict(mirror(b), kind=recolor.get(b['kind'], b['kind'])) for b in boxes[:west_count[0]]]
pads += [mirror(p) for p in pads[:west_count[1]]]
spawns += [mirror(s) for s in spawns[:west_count[2]]]

# ---------- shared middle ----------
box(-1.3, 1.3, -5.5, 5.5, 0, 2.6, 'stair')   # the bus
box(-1.3, 1.3, -6.3, -5.5, 0, 0.9, 'low')     # bus bumpers (step up)
box(-1.3, 1.3, 5.5, 6.3, 0, 0.9, 'low')
box(1.3, 2.5, 5.5, 6.7, 0, 1.8, 'block')     # crates: bumper -> crate -> bus roof
box(-2.5, -1.3, -6.7, -5.5, 0, 1.8, 'block')
# Street-end barriers (the cul-de-sac ends).
box(-6, 6, -21.5, -21, 0, 1.1, 'low')
box(-6, 6, 21, 21.5, 0, 1.1, 'low')

# ---------- ground + boundary ----------
HX, HZ = 37, 27
box(-HX, HX, -HZ, HZ, -1, 0, 'floor')
box(-HX - 1, HX + 1, -HZ - 1, -HZ, 0, 9, 'wall')
box(-HX - 1, HX + 1, HZ, HZ + 1, 0, 9, 'wall')
box(-HX - 1, -HX, -HZ, HZ, 0, 9, 'wall')
box(HX, HX + 1, -HZ, HZ, 0, 9, 'wall')

# Test Play starts at the first spawn: put a street-side one first for a nice view.
spawns.sort(key=lambda s: abs(s['x']))

out = {'name': 'Bean Street', 'version': 1, 'boxes': boxes, 'pads': pads, 'spawns': spawns}
path = os.path.join(os.path.dirname(__file__), '..', 'maps', 'bean-street.json')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, indent=1)
print(f'{len(boxes)} boxes, {len(pads)} pads, {len(spawns)} spawns -> {os.path.normpath(path)}')
