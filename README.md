# Cosmic Collisions

Impacts, simulated. Two planets of real mass fall together under their own
gravity and collide — the splash, the tidal arm, the debris disk, and the moon
that gathers out of it. Or a fourteen-kilometre asteroid comes down on the
Yucatán at twenty kilometres a second and opens a ninety-kilometre bowl in
eighty seconds.

A page each, over one engine.

- **[Giant impact](https://gaploid.github.io/cosmic-collisions/)** — Theia and
  the proto-Earth, and the Moon that comes out of the disk.
- **[Chicxulub](https://gaploid.github.io/cosmic-collisions/chicxulub.html)** —
  the impact that ended the Cretaceous, at two scales: the crater it digs, and
  the plume that comes out of the crater and reaches the far side of the world.

## The giant impact

Not a shape to assemble but a simulation. A proto-Earth and an impactor from
0.02 to 1 M⊕, differentiated iron core to mantle to crust, both arriving with an
eight-hour day: 16k to 262k particles, each pulling on all the others, touching
ones pushing back like a stiff spring and bleeding the energy into heat that
stays in the rock and lights it, deep red past 900 K, white past 40 000.

- **Presets** — *theia*, the canonical Moon-forming impact; *head-on*;
  *hit & run*; *twins*; *shatter*.
- **Readout** — a fixed table, the same rows in the same columns from the first
  look to the last: what stays, what orbits and what escapes, what Moon that
  disk would make — by the Ida–Canup–Stewart scaling from the disk's mass and
  its specific angular momentum — and the books on momentum, angular momentum
  and energy. A phone gets the outcome without the books.
- **Advanced panel** — impactor mass, impact angle, speed in units of escape
  velocity, particle count, bounce, core fraction and density restart the run;
  exposure, glow, shading and stars do not.

Drag rotates · wheel or pinch zooms · Space pauses · R restarts · F follows the
largest body.

On a phone it opens at 33k particles and draws at fewer pixels than the display
asks for, and gives back pixels — never physics — if the frames start to cost
too much; the particle slider still goes to 262k for anyone who wants to find
out what their phone can do.

Not SPH — no shocks, no vaporization — but the deformation, the tidal arm, the
disk and the re-accretion are all there.

## Chicxulub

### The crater

A cylinder of the Yucatán platform — three kilometres of carbonate over
crystalline basement, its wall and floor held still because the rest of the
world is not in the box — and a carbonaceous asteroid arriving at 60° from the
north-east at 20 km/s. The ground erupts; the ejecta curtain goes up as an
inverted cone; the transient bowl opens in about eighty seconds and then
collapses, wider and shallower, into the crater that is there today.

- **Presets** — *chicxulub*, 14 km at 20 km/s and 60°, the steeply-inclined
  trajectory Collins et al. found; *vertical*; *grazing*; a 1 km rock; a 30 km one.
- **Readout** — the energy in joules and in tonnes of TNT, the crater the run
  actually digs against the crater the scaling asks for, what was thrown past
  the rim and what is still in the air, how much of it left faster than orbital
  and than escape speed, the volume of shock melt, and the seismic magnitude.
- **Advanced panel** — impactor diameter, speed, angle, the thickness of the
  sediment and the density of the target restart the run.

### The planet

The Earth the giant impact is made of — a hundred thousand grains under their
own gravity, with contacts and heat, on the same engine — and a rock thrown at
it. This is the view where the surface breaks, and the one that has to be
honest about why it mostly cannot: at 131k grains Earth's grain is 218 km
across, and Chicxulub's rock was 14. The rock is always built at its true mass
and drawn as however many grains that is worth — one, when it is worth less
than one — so the *chicxulub* button does exactly what a 14 km rock does to a
planet, which is nothing anyone can see, and says so. From a few hundred
kilometres up the surface starts to go: *300 km* is two grains and a glow,
*1000 km* — Ceres-sized, and where the view opens — is sixty-three grains, a
white wound and a spray of ejecta into orbit, *2000 km* is a basin the size of
a continent with the whole hemisphere lit. The readout gives the energy in
multiples of Chicxulub, the rock in grains, what was thrown off and where it
went, and the books.

Above 2000 km this hands over to the giant-impact page, whose smallest rock is
0.02 M⊕ — the two pages tile the axis between them.

### The first day

The whole planet, and the same impact seen from far enough away that the crater
is a dot. Nothing here deforms, and a view that promised otherwise would be
lying: the rock is a 1.6-billionth of Earth's mass, and its energy 3×10⁻⁹ of
what pulling the planet apart would take — the giant impact next door carries
thirty-four million times more. What flies is what came out of the hole. The
plume leaves faster than the atmosphere can hold it, arcs over half a world,
and is coming down everywhere within two hours; the readout follows the layer
it lays as it goes, and the energy it hands back to the air on the way down.
That, and not the crater, is what ended the Cretaceous.

Earth is a shell of frozen particles the same renderer draws as a globe, with a
graticule instead of coastlines — a 66 Ma shoreline is not something to draw
from memory, and no redistributable reconstruction turned up. The motes are
tracers, not rocks: each carries the mass its own launch speed is worth, spread
evenly over the logarithm of that speed so the fast few which reach the far
side are visible at all, and drawn on a compressed scale of that mass the way
the glow is compressed. Nothing in this view is to scale except the
trajectories, which are exact.

**Where the numbers come from, and where they do not.** A contact model has no
shock and no vapour, so it cannot be asked what a 20 km/s impact does in its
first second. What is known is what comes out of that second, and that is what
the run is given: an excavation flow, radial from a point source buried at the
end of the projectile's path, whose speed at a given range is Housen &
Holsapple's and whose direction is Maxwell's Z-model — up and out at about 35°
where it reaches the surface. The flow goes to nothing at the transient radius
π-group scaling gives, so the hole is the right size by construction. What the
sim does itself, and what is therefore worth watching, is everything after: the
curtain, the ballistic blanket, the rim, and the collapse that turns a deep bowl
into a wide one. The readout prints the crater it dug beside the crater the
scaling asked for, so the two can be compared rather than confused — across the
five presets they agree to between 0.7 and 1.2.

For the globe: the plume's total is anchored to the 25 trillion tonnes
Chicxulub threw clear of its crater and scaled with the volume of the hole, and
its speeds are spread by Housen & Holsapple's v^−3μ. The motes are not slowed
by the air — modelling drag on a tracer with no size means inventing one — so
they arrive at the speed they left with, and the readout books that energy as
delivered to the atmosphere, which is where it really goes. Earth does not
rotate here; over a ballistic hour that moves a landing site by a few degrees.

The sulfur is not from the run at all. How much of the anhydrite reached the
stratosphere is a question about vapour plume expansion, which needs a hydrocode;
the readout quotes the published range and says whose it is.

The numbers it stands on: Collins, Melosh & Marcus 2005 (*Meteoritics &
Planetary Science* **40**, 817) for the crater scaling and the seismic
magnitude; Housen & Holsapple 2011 for the ejecta velocities; Melosh 1989 §5.4
for the Z-model; Collins et al. 2020 (*Nature Communications* **11**, 1480) for
the 45–60° trajectory from the north-east; Gulick et al. 2013 and IODP-ICDP
Expedition 364 for the target and the peak ring; Fischer-Gödde et al. 2024
(*Science* **385**, 752) for the carbonaceous impactor; Artemieva & Morgan 2017
and Gulick et al. 2025 for the two ends of the sulfur estimate.

## Tech

A page per scenario over a shared engine in `src/`, wired with plain script
tags — no dependencies, no build step, and a page still opens from disk. It is
WebGL 2 with no compute shaders to lean on, so the hard parts are tricks:
contacts from a hashed grid filled by depth-peeling, gravity from a 64³
particle mesh with the loose material corrected pairwise against it,
P³M-style, so moonlets bind instead of smearing. Its bodies are onions of
Fibonacci-spiral shells — a lattice cut to a sphere is terraced, and the skin
drew every step as a ring — relaxed and then crept into equilibrium so that
nothing pops out of the surface. Symplectic Euler, Morton order, and books on
momentum and energy that caught most of what was wrong. The picture is
screen-space fluid rendering — impostors, a bilateral blur that melts them
into a skin, a coverage cut that takes the beads off the limb — with a surface
drawn on the skin in each grain's own coordinates, so it rides the material;
a round body's skin leaning on the ball it is; and hot rock glowing by its
temperature and lighting everything else. The Milky Way behind the catalogue's stars, where it really
is. GGX, ACES and FXAA. The knobs are in `__impact.look`.

## The sky

The starfield is the real one: the Yale Bright Star Catalogue, 5th Revised Ed.,
every star down to magnitude 6 — 5080 of them, each carrying its right
ascension, declination, visual magnitude and B-V colour index in six bytes,
30 KB embedded in the page as base64. They sit on the celestial sphere and turn
with the world.

Star positions from the Bright Star Catalogue, 5th Revised Ed. (Hoffleit &
Warren), via the Harvard/SAO catalogue archive. Public domain / free to use with
credit.

## Changelog

Broad strokes, newest first; the commit history tells each one in full.

- **2026-08-27 — A surface.** The planet was a blue ball with the lumps the
  impostors left in it: one colour per material, no relief, no glint, a limb
  that tore into steps when the camera came close, and black behind it. It
  wears a surface now. Each grain carries its home — where it sat in its body
  when the body was built — through the blur as a fourth field, and the skin
  is textured in those coordinates, so the surface rides the material: it
  turns with the body, stretches with the arm, goes out with the ejecta. In
  them a noise draws continents and hills, a cellular noise craters, and the
  height's slope across the screen, from the derivatives the hardware keeps,
  tilts the normal — relief with no parametrisation. The magma ocean wears a
  crust of dark plates with the melt bright in the cracks between them; the
  cores are metal; the sun glints by GGX, rough on the crust, glossy on the
  melt, and the other body stands in it as a shadow. Where the skin is a
  round body's own — within a few particles of the radius its mass is drawn
  at — it leans on the ball: the normal is pulled toward the sphere's, and
  the silhouette is the sphere's, feathered over a pixel, which is what took
  the torn limb off the close view. The ball's radius is where the analysis
  finds the density fall away, not where the mass says a cold ball would
  end — a planet hot from the impact stands well above that, and a skin cut
  at the mass-radius peeled it — and the skin is pulled and cut only where
  it faces the way the ball's surface faces there, so the impactor crossing
  the planet's shell on its way in keeps its own. And the cut itself is
  only made while the bodies are whole balls, on the approach: after the
  impact the planet wears what fell back on it, a loose layer above any
  radius the analysis can name, and cutting at that radius left the layer
  hanging as a glowing rind with a black gap under it. The one ball's shadow on
  the other in sunlight went the same way: a body half into the planet
  stood in the planet's shadow from the inside. And the hot bodies' light
  on each other, which is real and by the inverse square — a magma moonlet
  three radii off outshines the sun on the planet's night side — ended in
  a hard terminator and cut the planet into zones, sunlit, moonlit and its
  own glow, with seams between; it wraps past the terminator now, as a
  light with a size does, and runs into a soft knee at six suns. And the
  light sits where the heat is — the glow-weighted centroid of the body's
  hot grains, their spread for its radius — not at its centre of mass:
  while two bodies are one group in contact the centre of mass is between
  them, a ball of the mass-radius round it cut across the impactor as a
  flat zone of light with a hard edge, and the edge jumped with every
  report; the light is eased toward each report now rather than jumped
  to it. The rule that a body's light leaves the body's own skin alone —
  convex, it cannot light itself, and the loose grains on it would sparkle
  — was that same sphere, everything nearer the light than its radius; it
  is the ball's own skin now, the pixels within a few particles of the
  ball's radius that face the way the ball faces there, and the sphere
  remains only for a light with no ball to its name. Where the material churns — a magma
  ocean convecting at the grain scale, two bodies' grains mixed at the
  contact — the home field is no surface, and a texture drawn in it
  shimmers from frame to frame: the surface fades out where the field's
  screen gradient outruns the skin's own, and the melt there is drawn
  smooth, which is what a churning melt is. A shell of air was drawn round
  each ball and taken out again: its colour swung from blue to yellow with
  the run's temperature, and a look that argues with the physics is worse
  than none. The *shading* switch turns the whole surface off and leaves
  the plain skin to read the run by. Behind it all, the Milky Way,
  drawn about the galactic plane where the catalogue's stars actually put it,
  with star clouds and dust lanes; a third, widest bloom; a little
  saturation. The home field is carried in full floats: close in, a pixel's
  step across it is a quarter of a half-float's quantum, and the relief,
  which is its screen derivative, came out as terraces; and close in, where
  the blur's twelve taps sit five pixels apart, a dense pass goes first —
  the raw depth steps at every disc's edge, each tap crossing an edge is a
  step in the sum, and the normal blinked with the comb's period as
  stripes. The render costs 0.8 ms more at the
  default view and 2.4 close in, on an RTX 4070 at 2400×1350 — measured
  against the old code in the same state and the same minute, since the
  GPU's mood between sessions is worth more than that. One bug on the
  way, found by counting NaNs in the HDR target with each debug view in
  turn: the relief normalised a zero vector where the screen derivatives'
  determinant was zero, `mix(n, NaN, 0.0)` is NaN, and a single NaN grows
  into a black rectangle as the separable bloom blurs it — every normalise
  in the shading has an alternative now.
- **2026-08-27 — The planet.** Asked for the Earth to be breakable — the
  particle planet of the giant impact, with the rock going into it — and it
  is: the engine that runs Theia moved out of its page into `src/nbody.js`,
  and Chicxulub's page got a third view that builds Earth out of it and throws
  a rock. The honest part is the rock's size. A 14 km stone is a six-thousandth
  of one grain, so it is built at its true mass, drawn as the one grain it is
  worth, and does nothing — which is the right answer, and the readout says
  so rather than hiding it. From a few hundred kilometres the surface starts
  to go, and the view opens on a Ceres-sized rock, where it does. On the way
  out of the page the engine picked up two things a small rock needs: a core
  fraction of its own, and a grain count and mass set by the caller. The
  extraction is checked the way the split was — Theia at t = 4, to nine
  decimals — after one bug, found by bisecting the run stage by stage: the
  options object was named `o`, and so was the offset the build loop used, so
  every parameter read after the first loop came back undefined and the
  contact dashpot was NaN.
- **2026-08-27 — The first day.** The crater is the small half of Chicxulub.
  The other half is what came out of it, and that is a whole-planet story: a
  plume leaving faster than the atmosphere can hold it, over the horizon inside
  a quarter of an hour, and coming down over the entire globe within two. So
  the scenario has a second view — Earth as a shell of frozen particles the
  same renderer draws as a globe, the rock arriving on it, and fifty thousand
  tracers carrying the plume out and bringing it back. Nothing deforms, because
  nothing can: the readout says how far short of moving the planet this is, and
  then gets on with the part that matters, which is the layer going down
  everywhere and the heat coming back with it. The renderer learned to size a
  particle by what it carries, and to stop one between the camera and a planet
  from drawing as a saucer.
- **2026-08-27 — Chicxulub.** The page simulated one thing, and the one thing
  was a planet. This is the other end of the scale: an asteroid six thousand
  times lighter than a single particle of the giant impact, hitting ground that
  is a patch rather than a world. So the gravity is a constant instead of a
  mesh, the clock runs in seconds instead of hours, the ground is a cylinder of
  the Yucatán platform with its wall and floor held still, and the box is cut to
  the crater rather than to a fixed size, so a kilometre of rock and thirty are
  resolved the same. The impactor is carried in rigid — at 20 km/s a contact
  model would have it through the ground before it touched — and at contact it
  is consumed: it becomes melt, and the ground is handed an excavation flow,
  radial from a point source at the end of the path it would have driven, with
  Housen & Holsapple's speed and Maxwell's Z-model direction, going to nothing
  at the transient radius π-scaling gives. Everything after is the sim's own,
  and it is the part worth watching: the curtain rising as an inverted cone, the
  blanket landing, the rim standing up, and the deep bowl slumping into a wide
  one over the next ten minutes. The readout prints the hole it dug beside the
  hole the scaling asked for. The engine they now share moved to `src/`, and
  each scenario is a page that links to the other.
- **2026-08-27 — A readout that holds still.** The report was a stack of
  sentences: rows appeared and vanished with the run, every number sat wherever
  the words before it ended, and the box changed width with the longest line, so
  following one figure meant finding it again each time. It is a table now —
  every row always present, an absent second body saying so rather than closing
  the gap, name, number and note each in a column of their own, the numbers
  right-aligned on their decimal points, and the whole box a fixed width.
  Between one look and the next nothing moves but the digits. The scaling's
  citation moved to this file, where it can be read once instead of every frame.
- **2026-08-27 — The phone's own readout.** A phone has no room for an audit:
  the report gives the outcome — what the planet came out as, what the disk it is
  wearing would make, what left for good — and the provenance of that figure, the
  impactor's share of every piece and the books stay on the wide screen that has
  room to argue. The clock and the run's numbers share one line across the foot;
  the advanced panel stops above whatever the foot already holds instead of
  sliding under it; and the corner carries a link to the source, where the
  sister page keeps its link on the desktop.
- **2026-08-26 — A phone can hold this.** The run was built for a desk. A phone
  takes the same collision at a quarter of the particles — 33k still splashes,
  still throws a disk, still gathers a moon — at 1.25× rather than the 3× its
  display asks for, and the picture falls to 85 % and then 72 % of a side if the
  frames stop coming, climbing back when they do. The canvas and the readouts
  sit in the viewport the phone actually shows, inside the notch and the home
  bar; held upright the report keeps its books to itself, laid on its side the
  panel takes the room left below it and scrolls the rest.
  Pause and restart are a square with a shape in it now, follow is off the panel
  and lives on the `f` key, and the page picked up Google Analytics.
- **2026-08-26 — A shorter panel.** The advanced panel lost its two spin
  sliders — a spin is a property of the rock, like its density, and both bodies
  keep the eight-hour day they start with — and says the rest in fewer words:
  the units moved into the labels, and a rule marks where the settings that
  restart the run end.
- **2026-08-26 — Skin.** The bodies are built as onions of Fibonacci shells
  instead of a lattice cut to a sphere, so the concentric rings the crust wore
  in every frame are gone; the pile is relaxed before it settles and settles
  at a creep, so nothing pops out of the surface; the grains are 4 % smaller,
  since a random pile jams looser than a lattice, which keeps the radius and
  the books; and the skin's silhouette is cut and feathered by a coverage
  field, which takes the staircase of lit discs off the limb.
- **2026-08-26 — The film.** An ACES-style tone curve — deeper shadows, a
  clean roll-off at the hottest — the sun as a disk with a glare that the
  bodies occlude, a light vignette, and FXAA. The knobs live in
  `__impact.look`.
- **2026-08-26 — Lit by the magma.** The planet and the second body light
  what is near them with the glow of their own surface: the arm and the
  disk get their planet-facing sides in orange, a moonlet is lit from
  below, the planet's cold far side stays dark, and the bodies shadow each
  other as balls — the first cut lit the crust spalled off the impactor's
  far side through the impactor, a glint along its rim.
- **2026-08-26 — Heat.** The heat the contacts make stays in the material
  and spreads by contact; every particle has a temperature and the rock glows
  by it — the planet a magma ocean at 3000 K a day after the canonical
  impact, the far side cold, the sparks off the contact white — and the
  readout says the mean. Bloom on what is brighter than white. On the way:
  the books were booking a barely-loaded contact's spring work as heat with
  either sign; the balance goes from −2.8 % to under a percent.
- **2026-08-26 — Faster.** A step at 131k from 2.5 ms to 1.4, and 4× runs at
  30 fps instead of 19: empty mesh blocks skipped, the mesh every eighth
  step, the particles kept in spatial order, the analysis read back without
  waiting, the spring let go after the splash. And the mesh deposit was
  losing 2 % of the mass to half-float rounding; it blends in full floats.
- **2026-08-26 — Dust, gone.** The points that rode on the particles never
  read as anything but noise; the skin is the body.
- **2026-08-26 — The disk binds.** Moonlets came apart into puffs: a cell
  of the gravity mesh is five particles wide and a moonlet is a cell or two.
  The loose material now gets its gravity corrected pairwise, P³M-style, and
  the disk collects into moonlets that stay; a moon line says what Moon the
  disk would make.
- **2026-08-26 — The books.** The readout keeps momentum, angular momentum
  and energy, and they caught the gravity mesh braking a spinning planet by
  lagging four steps behind it; the mesh now pulls as one impulse where it
  is measured, and cell on cell at centres of mass, and L holds to 0.01 %.
- **2026-08-26 — Spin.** Both bodies arrive turning about their axes, with
  eight-hour days by default and sliders from none to a 2.6-hour Earth, each
  cut beforehand as the Maclaurin spheroid its spin calls for. Dust is off by
  default.
- **2026-08-25 — Cores.** Both bodies get an iron core, a mantle and a crust,
  with density as mass; the readout says what each piece is made of and how
  long the planet's day is.
- **2026-08-25 — A brighter sky.** The page gets the same real catalogue sky
  the main animation has, instead of a hash.
- **2026-08-25 — Impact.** Two planets of real mass collide under their own
  gravity, on the GPU, from the canonical Moon-forming impact to a hit-and-run.
  A readout says what stays, what orbits, and what escapes.

The page began as a second page of [stardust](https://github.com/Gaploid/stardust)
and moved into this repository on 2026-08-26, with its history.

## Analytics

This site uses Google Analytics to understand basic usage.

## License

MIT — see [LICENSE](LICENSE).
