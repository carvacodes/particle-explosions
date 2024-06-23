window.addEventListener('load', ()=>{
  /*******************************************************************************/
  /*                                                                             */
  /*                                   Classes                                   */
  /*                                                                             */
  /*******************************************************************************/

  //////////////////////////
  //      RNG Class       //
  //////////////////////////
  // Using a fixed set of RNG values dramatically improves processing time by preventing constant calls to Math.random()
  class RNG {
    constructor() {
      this.iterator = 0;
      this.queue = [];
      for ( let i = 0; i < 65535; i++) {
        this.queue.push(Math.random());
      }
    }

    // the class's only method simply gets the next value in the RNG chain
    value() {
      this.iterator = this.iterator == this.queue.length ? 0 : this.iterator + 1;
      return this.queue[this.iterator];
    }
  }

  ////////////////////////////////
  //    Particle Group Class    //
  ////////////////////////////////
  // Particles are grouped together, since all particles spawning from one burst are related in hue
  // This also gives the opportunity to divvy up rendering operations a bit more
  class ParticleGroup {
    constructor(x, y, hue) {
      this.x = x;
      this.y = y;
      this.hue = Math.round(hue);
      this.particles = {};    // as opposed to storing as an array, ths implementation will use objects with numeric indices (0 through particlesPerBurst)
      this.rendering = true;

      for (let i = 0; i < particlesPerBurst; i++) {
        this.particles[i] = new Particle(this.x, this.y);
        this.particles.length = particlesPerBurst;
      }
    }

    // recalculates the hue on demand. used when the particle group is moved
    recalculateHue() {
      this.hue = Math.round(rng.value() * 360);
    }

    // moves the entire particle group and resets all the particle locations to the group's origin
    repositionGroup(x, y) {
      this.x = x;
      this.y = y;
      for (let i = 0; i < this.particles.length; i++) {
        this.particles[i].x = this.x;
        this.particles[i].y = this.y;
      }
      this.rendering = true;
    }

    // this method is called when a particle group is being reused. gathers all the main initialization logic together
    respawn(x, y) {
      this.recalculateHue();
      this.repositionGroup(x, y);
      this.queueForRender(renderer);
      this.rendering = true;
      for (let i = 0; i < this.particles.length; i++) {
        this.particles[i].resetValues();
      }
    }

    // this method runs for all of a group's particles when it is still being rendered
    // particles have internal logic in their move() method to handle their own specifics and math
    stepParticles(refreshThrottle) {
      let continueRendering = false;

      for (let i = 0; i < this.particles.length; i++) {
        let particle = this.particles[i];
        if (particle.lifetime > 0 ) {
          if (!continueRendering) { continueRendering = true; }
          particle.move(refreshThrottle);
        }
      }

      if (!continueRendering) {
        this.rendering = false;
      }
    }

    queueForRender(renderer) {
      renderer.enqueue(this);
    }
  }

  //////////////////////////
  //    Particle Class    //
  //////////////////////////
  class Particle {
    constructor(x, y) {
      this.x = x;           // position info
      this.y = y;
      this.z;
      this.prevX = this.x;  // stores the last position. utilized in particle stroke rendering
      this.prevY = this.y;
      this.prevZ = this.z;
      this.xSpeed;          // speed info
      this.ySpeed;
      this.zSpeed;
      this.airborne;        // once y speed reaches a negligible amount, set this boolean to false
      this.lifetime;        // the particle's lifetime drops at every move() call, and it is skipped for processing and rendering if lifetime <= 0

      this.resetValues();   // this immediately sets any values that are not initialized with values to something random
    }

    // resets and re-randomizes the particle's values. used at instantiation and when the parent particleGroup moves
    resetValues() {
      this.lifetime = 60 + Math.round(rng.value() * 30);  // particles will automatically be culled when their lifetime hits zero
      this.z = Math.max((4 * _h / 5) + Math.round(rng.value() * _h / 12), this.y);  // simulates depth (see move/render methods)
      this.xSpeed = (11 + (rng.value() * -22)) * dpr;      // speed variables
      this.ySpeed = (16 + (rng.value() * -32)) * dpr;      // for each axis
      this.zSpeed = (0.5 + (rng.value() * -1)) * dpr;      // note that zSpeed is set much lower, as depth changes more subtly/slowly than x/y position
      this.airborne = true;
      this.prevX = this.x;
      this.prevY = this.y;
      this.prevZ = this.z;
    }

    // move functions for the particle. the amount of movement is adjusted by the last requestAnimationFrame call's duration.
    move(refreshThrottle) {
      this.lifetime -= refreshThrottle;

      // no further processing for particles outside the viewport or whose lifetime is 0 or less
      if (this.x < 0 || this.x > _w || this.y > _h || this.lifetime <= 0) {
        this.lifetime = -1;
        return;
      }
      
      // store previous position values
      this.prevX = this.x;
      this.prevY = this.y;
      this.prevZ = this.z;

      // if floors are not enabled, do a flat application of the x/y speeds to the particle's coords. no change to speed here.
      if (!enableFloor) {
        this.x += this.xSpeed * refreshThrottle;
        this.y += this.ySpeed * refreshThrottle;
        this.z += this.zSpeed * refreshThrottle;
      } else {
        
        // 3 conditions:
        // on the ground -> your current ySpeed is negligible and your distance to z is negligible
        // bouncing -> your next proposed y position is greater than your z position, and your current or proposed y speeds are large.
        // free fall -> your next proposed y position is less than your z position

        let proposedY = this.y + (this.ySpeed * refreshThrottle);
        let proposedZ = this.z + (this.zSpeed * refreshThrottle);
        
        let prevYSpeed = this.ySpeed;
        
        this.xSpeed = this.xSpeed - (this.xSpeed * airResistance * refreshThrottle);
        this.zSpeed = this.zSpeed - (this.zSpeed * airResistance * refreshThrottle);
        this.ySpeed = this.ySpeed - (this.ySpeed * airResistance * refreshThrottle) + (gravity * refreshThrottle);;
        this.z += this.zSpeed * refreshThrottle;

        let movementProportion = (Math.abs((this.y - this.z) / this.ySpeed) / refreshThrottle);
        
        if (!this.airborne) {
          if (this.y < _h * (72/100)) { this.lifetime = -1; }   // if the particle is above the reflective floor draw area, kill it

          // set coords
          this.x += this.xSpeed * refreshThrottle;
          this.y += this.zSpeed * refreshThrottle;

        } else if (proposedY < proposedZ) {
          // free fall
          // set ySpeed

          // set coords
          this.x += this.xSpeed * refreshThrottle;          
          this.y += (this.ySpeed * refreshThrottle) + (this.zSpeed * refreshThrottle);
        } else {
          // bounce
          if (this.y < _h * (72/100)) { this.lifetime = -1; }   // if the particle is above the reflective floor draw area, kill it
          // since a bounce interrupts what would be a full y axis displacement,
          // we need to move only a proportion of the final position
          // this value can be calculated as the amount of movement allowed divided by the full proposed movement
          
          // hold on to the previous ySpeed, so calculations can be done for airbornedness
          
          // set ySpeed
          this.ySpeed *= -0.6;
          
          // set coords
          // we also need to snap the particle's y position to its z position and to the proportion-affected x-position
          this.x += this.xSpeed * movementProportion * refreshThrottle;
          this.y = this.z + this.zSpeed * refreshThrottle;
          
          // if the resulting bounce speed is less than gravity, set the particle to no longer airborne
          if (Math.abs(Math.abs(this.ySpeed) - Math.abs(prevYSpeed)) < gravity / 3) {
            this.airborne = false;
          }
        }
      }
    }
  }

  //////////////////////////
  //    Renderer Class    //
  //////////////////////////
  // handles drawing functions for particle groups and particles. contains the canvas and context that will be used for drawing
  class Renderer {
    constructor(canvas) {
      this.renderQueue = [];
      this.clearTimer = 0;

      // primary canvas for drawing
      this.canvas = canvas;
      this.ctx = this.canvas.getContext('2d', {willReadFrequently: true});
      this.canvas.width = _w;
      this.canvas.height = _h;

      // canvas for efficient offscreen rendering
      this.hiddenCanvas = document.createElement('CANVAS');
      this.hiddenCanvas.id = 'hiddenCanvas';
      this.hiddenCanvas.width = _w;
      this.hiddenCanvas.height = _h;

      this.hiddenCtx = this.hiddenCanvas.getContext('2d', {willReadFrequently: true});
      this.hiddenCtx.lineCap = 'round';

      // canvas for rendering reflections
      this.reflectCanvas = document.createElement('CANVAS');
      this.reflectCanvas.id = 'reflectCanvas';
      this.reflectCanvas.style.zIndex = '-2';
      this.reflectCanvas.width = _w;
      this.reflectCanvas.height = _h;

      this.reflectCtx = this.reflectCanvas.getContext('2d');
      this.reflectCtx.lineCap = 'round';
      
      document.body.appendChild(this.reflectCanvas);

      // canvas for rendering main canvas glow
      this.glowCanvas = document.createElement('CANVAS');
      this.glowCanvas.id = 'glowCanvas';
      this.glowCanvas.style.filter = 'blur(2px) brightness(1.1) contrast(1.2)';
      this.glowCanvas.style.zIndex = '-1';
      this.glowCanvas.width = _w;
      this.glowCanvas.height = _h;

      this.glowCtx = this.glowCanvas.getContext('2d');

      document.body.appendChild(this.glowCanvas);
    }

    // clears the canvas. called only if "persist strokes" is off.
    clear() {
      this.ctx.clearRect(0, 0, _w, _h);
      this.hiddenCtx.clearRect(0, 0, _w, _h);
      this.reflectCtx.clearRect(0, 0, _w, _h);
      this.glowCtx.clearRect(0, 0, _w, _h);
    }

    // a helper method that gathers particle groups into a queue to be rendered, instead of looping over all particle groups (and particles) every time
    enqueue(groupToRender) {
      this.renderQueue.push(groupToRender);
    }

    // draw to offscreen canvas first; this image can be copied onto the visible canvases (regular and glow canvases)
    renderHidden() {
      for (let i = 0; i < this.renderQueue.length; i++) {
        // shift the particleGroup off the render queue. this method exits when the render queue is empty
        let pGroup = this.renderQueue[i];
        let subgroupSize = Math.ceil(pGroup.particles.length / 3);
        let lastSubGroup = 1;

        // set initial values for the context; these are the values when (currentSubgroup == 1)
        this.hiddenCtx.beginPath();
        this.hiddenCtx.lineWidth = 3 * dpr;
        this.hiddenCtx.strokeStyle = `hsl(${pGroup.hue}, 100%, 50%)`;

        // loop through the queued group's particles
        for (let j = 0; j < pGroup.particles.length; j++) {
          // set context line width and stroke style only as needed, depending on the current subgroup
          let currentSubgroup = Math.ceil(j / subgroupSize) + 1;
          if (currentSubgroup != lastSubGroup) {
            // if the subgroup has changed, close the last path before opening the next
            this.hiddenCtx.stroke();
            this.hiddenCtx.beginPath();

            // 4 - currentSubgroup will equal either 2 or 1 (a size of 3 is already taken care of by the context draw styles outside the loop)
            // "4 - " is used to make sure that smaller particles are tied to higher lightness
            this.hiddenCtx.lineWidth = (4 - currentSubgroup) * dpr;
            // hue is a group value, and lightness is between 45 + 16.6667 and 95. coinciding with size, larger particles are more deeply colored (lightness closer to 50)
            this.hiddenCtx.strokeStyle = `hsl(${pGroup.hue}, 100%, ${40 + ((50 / 3) * currentSubgroup)}%)`;
          }

          let particle = pGroup.particles[j];
          
          if (particle.lifetime <= 0) { continue; }
          
          // this if statement is quite expensive, but it guarantees that lower z-index particles are never drawn on top of higher ones
          if (particle.zSpeed < 0) {
            this.hiddenCtx.globalCompositeOperation = 'destination-over';
          } else {
            this.hiddenCtx.globalCompositeOperation = 'source-over';
          }

          this.hiddenCtx.moveTo(particle.prevX, particle.prevY);
          this.hiddenCtx.lineTo(particle.x, particle.y);

          // only stroke here if the particle drawing subgroup changed; otherwise, this is a polyline
          if (currentSubgroup != lastSubGroup) {
            this.hiddenCtx.beginPath();
            lastSubGroup = currentSubgroup;
          }
        }

        // catches the last open path after the loop ends (because currentSubgroup is still equal to lastSubGroup at that point)
        this.hiddenCtx.stroke();
      }
    }

    renderReflect() {
      for (let i = 0; i < this.renderQueue.length; i++) {
        // shift the particleGroup off the render queue. this method exits when the render queue is empty
        let pGroup = this.renderQueue[i];
        let subgroupSize = Math.ceil(pGroup.particles.length / 3);
        let lastSubGroup = 1;

        // set initial values for the context; these are the values when (currentSubgroup == 1)
        this.reflectCtx.beginPath();
        this.reflectCtx.lineWidth = 3 * dpr;
        this.reflectCtx.strokeStyle = `hsl(${pGroup.hue}, 70%, 60%)`;

        // loop through the queued group's particles
        for (let j = 0; j < pGroup.particles.length; j++) {
          // set context line width and stroke style only as needed, depending on the current subgroup
          let currentSubgroup = Math.ceil(j / subgroupSize) + 1;
          if (currentSubgroup != lastSubGroup) {
            this.reflectCtx.stroke();
            this.reflectCtx.beginPath();

            // 4 - currentSubgroup will equal either 2 or 1 (a size of 3 is already taken care of by the context draw styles outside the loop)
            // "4 - " is used to make sure that smaller particles are tied to higher lightness
            this.reflectCtx.lineWidth = (4 - currentSubgroup) * dpr;
            // hue is a group value, and lightness is between 45 + 16.6667 and 95. coinciding with size, larger particles are more deeply colored (lightness closer to 50)
            this.reflectCtx.strokeStyle = `hsl(${pGroup.hue}, 70%, ${40 + ((30 / 3) * currentSubgroup)}%)`;
          }

          let particle = pGroup.particles[j];
          
          if (particle.lifetime <= 0) { continue; }
          
          if (particle.zSpeed < 0) {
            this.reflectCtx.globalCompositeOperation = 'destination-over';
          } else {
            this.reflectCtx.globalCompositeOperation = 'source-over';
          }

          this.reflectCtx.moveTo(particle.prevX, particle.prevY + ((particle.prevZ - (particle.prevY )) * 2) + (3 * dpr));
          this.reflectCtx.lineTo(particle.x, particle.y + ((particle.z - (particle.y )) * 2) + (3 * dpr));

          // only stroke here if the particle drawing subgroup changed; otherwise, this is a polyline
          if (currentSubgroup != lastSubGroup) {
            this.reflectCtx.beginPath();
            lastSubGroup = currentSubgroup;
          }
        }

        // catches the last open path after the loop ends (because currentSubgroup is still equal to lastSubGroup at that point)
        this.reflectCtx.stroke();
      }
    }

    // render the visible canvas from the hidden one
    renderVisible() {
      let baseImgData = this.hiddenCtx.getImageData(0, 0, this.hiddenCanvas.width, this.hiddenCanvas.height);
      this.ctx.putImageData(baseImgData, 0, 0);
      if (enableGlow) { this.glowCtx.putImageData(baseImgData, 0, 0); }
    }

    // draws particle groups that are currently rendering
    render() {
      if (!persistStrokes) { this.clear(); }
      this.renderHidden();
      if (enableFloor && enableReflections) { this.renderReflect(); }
      this.renderVisible();

      this.renderQueue = [];    // empty the render queue every time
    }
  }

  /*******************************************************************************/
  /*                                                                             */
  /*                                   Globals                                   */
  /*                                                                             */
  /*******************************************************************************/
  
  let dpr = window.devicePixelRatio;
  let gravity = 1.7 * dpr;              // pretty self-explanatory, but this feels like a good value
  let airResistance = 0.002 * dpr;      // particles slow down by this factor the longer they are in the air
  let particlesPerBurst = 50;                               // particles per burst; user-configurable at low/med/high/extreme
  let newBurstTimer = 60;                                   // the timer that will allow new particle bursts to form automatically
  let persistStrokes = false;     // user toggleable variable that controls whether to clearRect() the canvas every frame, resulting in either discrete particles or streaming lines
  let enableFloor = true;         // user toggleable variable that shows or hides the reflective floor texture and toggles gravity
  let enableGlow = true;          // user toggleable variable that shows or particle glow
  let enableReflections = true;   // user toggleable variable that enables rendering reflections
  let autoBursts = true;          // user toggleable variable that enables automatic bursts
  let _w = innerWidth * dpr;    // set global vars for DPR-adjusted width/height
  let _h = innerHeight * dpr;   // set global vars for DPR-adjusted width/height

  let rng = new RNG();
  let renderer = new Renderer(document.getElementById('canvas'));
  let particleGroups = [new ParticleGroup(_w / 2, _h / 3, 270)];    // initialize this array with a group of particles
  
  /*******************************************************************************/
  /*                                                                             */
  /*                                  Listeners                                  */
  /*                                                                             */
  /*******************************************************************************/
  // on every click, create a particle burst at that position
  document.addEventListener('mousedown', createParticleBurst);
  document.addEventListener('touchstart', createParticleBurst, {passive: false});
  document.addEventListener('touchmove', (e) => {e.preventDefault()}, {passive: false});

  window.addEventListener('resize', () => { window.location.reload(); })

  // get the relevant button objects
  let particleCountButton = document.getElementById('particleCountButton');
  let floor = document.getElementsByClassName('floor')[0];

  // stop immediate propagation in clicks on buttons prevent particle bursts while clicking a button
  document.addEventListener('click', (e) => {
    if (e.target.tagName != 'BUTTON') { return; }

    e.stopImmediatePropagation();

    switch (e.target.id) {
      case 'particleCountButton':
        if (particlesPerBurst == 50) {            // currently at low; set to medium
          particlesPerBurst = 100;
          particleCountButton.innerText = 'Particle Count: Medium';
          particleCountButton.className = 'count-med';
        } else if (particlesPerBurst == 100) {    // currently at medium; set to high
          particlesPerBurst = 250;
          particleCountButton.innerText = 'Particle Count: High';
          particleCountButton.className = 'count-high';
        } else if (particlesPerBurst == 250) {    // currently at high; set to extreme
          particlesPerBurst = 1000;
          particleCountButton.innerText = 'Particle Count: Extreme';
          particleCountButton.className = 'count-extreme';
        } else if (particlesPerBurst == 1000) {   // currently at extreme; set to low
          particlesPerBurst = 50;
          particleCountButton.innerText = 'Particle Count: Low';
          particleCountButton.className = 'count-low';
        }
        newBurstTimer = 60;
        particleGroups = [];
        particleGroups.push(new ParticleGroup(_w / 2, _h / 3, rng.value() * 360));
      break;
      case 'enableReflectionsButton':
        if (!enableFloor) { return; }
        enableReflections = enableReflections ? false : true;
        enableReflectionsButton.classList.toggle('active');
      break;
      case 'enableFloorButton':
        e.stopImmediatePropagation();
        enableFloor = enableFloor ? false : true;
        enableFloorButton.classList.toggle('active');
        floor.style.display = enableFloor ? 'initial' : 'none';
        if (!enableFloor) {
          enableReflectionsButton.classList.remove('active');
          enableReflections = false;
        } else {
          enableReflectionsButton.classList.add('active');
          enableReflections = true;
        }
      break;
      case 'enableGlowButton':
        e.stopImmediatePropagation();
        enableGlow = enableGlow ? false : true;
        enableGlowButton.classList.toggle('active');
      break;
      case 'persistStrokesButton':
        e.stopImmediatePropagation();
        persistStrokes = persistStrokes ? false : true;
        persistStrokesButton.classList.toggle('active');
        if (!persistStrokes) {
          clearCanvasButton.classList.remove('ready');
        } else {
          clearCanvasButton.classList.add('ready');
        }
      break;
      case 'autoBurstButton':
        e.stopImmediatePropagation();
        autoBursts = autoBursts ? false : true;
        newBurstTimer = 0;
        autoBurstButton.classList.toggle('active');
      break;
      case 'clearCanvasButton':
        e.stopImmediatePropagation();
        renderer.clear();
      break;
    }
  })
  
  /*******************************************************************************/
  /*                                                                             */
  /*                                  Functions                                  */
  /*                                                                             */
  /*******************************************************************************/

  // this function tries to reuse an existing particle burst if it's not currently being rendered to save on extra object instantiations
  // if it finds a currently-unused particle group, it changes its origin and respawns (re-randomizes) its particles
  // if all particle bursts are already being used, it will instantiate another
  function particleBurst(x, y) {
    for (let i = 0; i < particleGroups.length; i++) {
      let pGroup = particleGroups[i];
      if (!pGroup.rendering) {
        pGroup.respawn(x, y);
        return;
      } else {
        if (i+1 >= particleGroups.length) {
          particleGroups.push(new ParticleGroup(x, y, rng.value() * 360));
          return;
        } else {
          continue;
        }
      }
    }
  }

  // a helper function for creating particle bursts on mousedown or touchstart
  function createParticleBurst(e) {
    let event = e;  // placeholder for event; used for preventDefault later. this allows us to reuse this same handler for mouse and touch events
    if (e.changedTouches) {
      e = e.changedTouches[0];
    }
    if (e.target.tagName == 'BUTTON') {
      return;
    }
    if (event.changedTouches) { event.preventDefault(); }   // as promised: preventDefault on touch events
    particleBurst(e.clientX * dpr, e.clientY * dpr);
    newBurstTimer = 60;   // wait two seconds after the last user-initiated burst
  }

  // procedurally generate particles if the user isn't interacting
  function autoPopulate() {
    particleBurst(100 + (rng.value() * (_w / 2)) + (_w / 4),
                  100 + (rng.value() * (2 * _h / 3)),
                  rng.value() * 360);
  }
  
  /*******************************************************************************/
  /*                                                                             */
  /*                               Animation Loop                                */
  /*                                                                             */
  /*******************************************************************************/

  // these variables will adjust movement speed to match the frame rate of the device (the time between rAF calls)
  let firstFrameTime = performance.now();
  let refreshThrottle = 1;
  let tempRefreshThrottle = 0;

  function animate(callbackTime) {
    // target 30fps by dividing the time between rAF calls by 30 to calculate per-frame movement
    tempRefreshThrottle = callbackTime - firstFrameTime;
    firstFrameTime = callbackTime || 0;
    refreshThrottle = Math.min(tempRefreshThrottle / 30, 1);

    // if the user has autoburst enabled
    if (autoBursts) {
    // if the newBurstTimer timer has reached zero, autopopulate
      if (newBurstTimer > 0) {
        newBurstTimer -= refreshThrottle;
      } else if (newBurstTimer <= 0) {
        autoPopulate();
        newBurstTimer = 60;  // set off a particle burst every second
      }
    }
        
    // loop particleGroups
    for (let i = 0; i < particleGroups.length; i++) {
      let pGroup = particleGroups[i];
      // if a particle group is still rendering (it has at least one particle with a lifetime > 0), update its particles' positions and queue it for rendering
      if (pGroup.rendering) {
        pGroup.stepParticles(refreshThrottle);
        pGroup.queueForRender(renderer);
      }
    }

    // render, passing the calculated refreshThrottle. This will help set appropriate line thicknesses for particle rendering
    if (renderer.renderQueue.length > 0) {
      renderer.render(refreshThrottle);
    }
    window.requestAnimationFrame(animate);
  }

  // at last: init!
  window.requestAnimationFrame(animate);
});