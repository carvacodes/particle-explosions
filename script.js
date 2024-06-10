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
      this.particles = [];
      this.rendering = true;

      for (let i = 0; i < particlesPerBlast; i++) {
        this.particles.push(new Particle(this.x, this.y));
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
      this.prevLifetime;    // the particle's lifetime on the previous move() call
      this.lightness;       // handles the individual coloration of a particle (since its hue is managed by its parent particleGroup)
      this.size;            // the weight of the particle, which ends up being its lineWidth in context.stroke operations

      this.resetValues();   // this immediately sets any values that are not initialized with values to something random
    }

    // resets and re-randomizes the particle's values. used at instantiation and when the parent particleGroup moves
    resetValues() {
      this.lifetime = 60 + Math.round(rng.value() * 30);  // particles will automatically be culled when their lifetime hits zero
      this.prevLifetime = this.lifetime;
      this.lightness = Math.round(60 + rng.value() * 40); // added lightness for more variety
      this.size = Math.ceil(rng.value() * 2);                        // controls the stroke or rect size, depending on the particle render type currently chosen
      this.z = Math.max((4 * _h / 5) + Math.round(rng.value() * _h / 12), this.y);  // simulates depth (see move/render methods)
      this.xSpeed = (11 + (rng.value() * -22)) * window.devicePixelRatio;      // speed variables
      this.ySpeed = (16 + (rng.value() * -32)) * window.devicePixelRatio;      // for each axis
      this.zSpeed = (0.5 + (rng.value() * -1)) * window.devicePixelRatio;      // note that zSpeed is set much lower, as depth changes more subtly/slowly than x/y position
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
        return;
      }

      /*
      3 conditions:
      on the ground -> your current ySpeed is negligible and your distance to z is negligible
      bouncing -> your next proposed y position is greater than your z position, and your current or proposed y speeds are large.
      free fall -> your next proposed y position is less than your z position
      */
      let proposedY = this.y + this.ySpeed * refreshThrottle;
      let proposedYSpeed = this.ySpeed - (this.ySpeed * airResistance * refreshThrottle) + (gravity * refreshThrottle);
      let proposedZ = this.z + this.zSpeed * refreshThrottle;
      let proposedZSpeed = this.zSpeed - (this.zSpeed * airResistance * refreshThrottle);

      if (!this.airborne) {
        // on the ground
        // set speeds
        this.xSpeed = this.xSpeed - (this.xSpeed * airResistance * refreshThrottle);
        this.zSpeed = proposedZSpeed;
        
        // set coords
        this.x += this.xSpeed * refreshThrottle;
        this.y += this.zSpeed * refreshThrottle;
        this.z += this.zSpeed * refreshThrottle;
      } else if (proposedY < proposedZ) {
        // free fall
        // set speeds
        this.xSpeed = this.xSpeed - (this.xSpeed * airResistance * refreshThrottle);
        this.ySpeed = proposedYSpeed;
        this.zSpeed = proposedZSpeed;
        
        // set coords
        this.x += this.xSpeed * refreshThrottle;
        this.y += (this.ySpeed * refreshThrottle) + (this.zSpeed * refreshThrottle);
        this.z += this.zSpeed * refreshThrottle;
      } else {
        // bounce
        // since a bounce interrupts what would be a full y axis displacement,
        // we need to move only a proportion of the final position
        // this value can be calculated as the amount of movement allowed divided by the full proposed movement
        let movementProportion = Math.abs((this.y - this.z) / proposedYSpeed) / refreshThrottle;
        
        // hold on to the previous ySpeed, so calculations can be done for airbornedness
        let prevYSpeed = this.ySpeed;

        // set speeds
        this.xSpeed = this.xSpeed - (this.xSpeed * airResistance * refreshThrottle);
        this.ySpeed = (-0.6) * proposedYSpeed;
        this.zSpeed = proposedZSpeed;
        
        // set coords
        // we also need to snap the particle's y position to its z position and to the proportion-affected x-position
        this.x += this.xSpeed * movementProportion * refreshThrottle;
        this.z += this.zSpeed * refreshThrottle;
        this.y = this.z + this.zSpeed * refreshThrottle;

        // if the resulting bounce speed is less than gravity, set the particle to no longer airborne
        if (Math.abs(Math.abs(this.ySpeed) - Math.abs(prevYSpeed)) < gravity) {
          this.airborne = false;
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

      // canvas for rendering reflections
      this.reflectCanvas = document.createElement('CANVAS');
      this.reflectCanvas.id = 'reflectCanvas';
      this.reflectCanvas.style.filter = 'blur(0.5px) brightness(0.7)';
      this.reflectCanvas.style.zIndex = '-1';
      this.reflectCtx = this.reflectCanvas.getContext('2d', {willReadFrequently: true});
      this.reflectCanvas.width = _w;
      this.reflectCanvas.height = _h;

      document.body.appendChild(this.reflectCanvas);

      // canvas for rendering main canvas glow
      this.glowCanvas = document.createElement('CANVAS');
      this.glowCanvas.id = 'glowCanvas';
      this.glowCanvas.style.filter = 'blur(2px) brightness(1.1) contrast(1.2)';
      this.glowCanvas.style.opacity = '0.7';
      this.glowCanvas.style.zIndex = '-2';
      this.glowCtx = this.glowCanvas.getContext('2d');
      this.glowCanvas.width = _w;
      this.glowCanvas.height = _h;

      document.body.appendChild(this.glowCanvas);
    }

    // clears the canvas. called only if "persist strokes" is off.
    clear() {
      this.ctx.clearRect(0, 0, _w, _h);
      this.reflectCtx.clearRect(0, 0, _w, _h);
      this.glowCtx.clearRect(0, 0, _w, _h);
    }

    // a helper method that gathers particle groups into a queue to be rendered, instead of looping over all particle groups (and particles) every time
    enqueue(groupToRender) {
      this.renderQueue.push(groupToRender);
    }

    // helper function that uses main canvas imageData to create a source image which can then be CSS-filtered
    renderGlow() {
      let baseImgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      this.glowCtx.putImageData(baseImgData, 0, 0);
    }

    // draws particle groups that are currently rendering
    render(refreshThrottle) {
      if (!persistStrokes) {
        this.clear(refreshThrottle);
      }

      while (this.renderQueue.length > 0) {
        // shift the particleGroup off the render queue. this method exits when the render queue is empty
        let pGroup = this.renderQueue.pop();

        // loop through the queued group's particles
        for (let j = 0; j < pGroup.particles.length; j++) {
          let particle = pGroup.particles[j];

          
          if (particle.lifetime <= 0) { continue; }
          
          this.ctx.strokeStyle = this.ctx.fillStyle = `hsl(${pGroup.hue}, 100%, ${particle.lightness}%)`;
          let renderedParticleSize = this.ctx.lineWidth = this.reflectCtx.lineWidth = particle.size * window.devicePixelRatio;
          let halfParticleSize = renderedParticleSize / 2;
          
          // draw reflections first
          // check height; if within the reflectThreshold, and if enableFloor is true, draw reflections
          let height = Math.abs(particle.z - particle.y);
          
          if (enableFloor && enableReflections && height < reflectThreshold) {
            let heightFalloff = 1 - (height / (reflectThreshold));  // heightFalloff is a ratio for most of these properties; closer to the ground = more effect
            this.reflectCtx.strokeStyle = this.reflectCtx.fillStyle = `hsl(${pGroup.hue}, ${50 * heightFalloff}%, ${(particle.lightness * 0.25) + (particle.lightness * heightFalloff * 0.5)}%)`;
            
            // draw the reflection based on the reflected point's distance from the particle's z-position
            // use lineTo for persisted strokes
            if (persistStrokes) {
              this.reflectCtx.beginPath();
              this.reflectCtx.moveTo(particle.prevX, particle.prevY + ((particle.prevZ - (particle.prevY )) * 2) + 2);
              this.reflectCtx.lineTo(particle.x, particle.y + ((particle.z - (particle.y )) * 2) + 2);
              this.reflectCtx.stroke();
            }
            this.reflectCtx.fillRect((particle.x) - halfParticleSize, (particle.x, particle.y + ((particle.z - (particle.y )) * 2) + 2) - halfParticleSize, renderedParticleSize, renderedParticleSize);
          }

          // draw particles themselves next. particles are drawn after reflections to ensure that actual particle graphics are prioritized
  
          if (persistStrokes) {
            this.ctx.beginPath();
            this.ctx.moveTo(particle.prevX, particle.prevY);
            this.ctx.lineTo(particle.x, particle.y);
            this.ctx.stroke();
          }
          this.ctx.fillRect(particle.x - halfParticleSize, particle.y - halfParticleSize, renderedParticleSize, renderedParticleSize);
        }
      }

      this.renderGlow();
    }
  }

  /*******************************************************************************/
  /*                                                                             */
  /*                                   Globals                                   */
  /*                                                                             */
  /*******************************************************************************/
  
  let gravity = 1.7 * window.devicePixelRatio;              // pretty self-explanatory, but this feels like a good value
  let airResistance = 0.002 * window.devicePixelRatio;      // particles slow down by this factor the longer they are in the air
  let particlesPerBlast = 80;                               // 80 is a reasonable size for the number of particles; straddles the line between boring to see and rough to process
  let newBurstTimer = 60;                                   // the timer that will allow new particle bursts to form automatically
  let reflectThreshold = 200 * window.devicePixelRatio;     // the threshold for when reflections will appear on the ground
  let persistStrokes = false;     // user toggleable variable that controls whether to clearRect() the canvas every frame, resulting in either discrete particles or streaming lines
  let enableFloor = true;         // user toggleable variable that shows or hides the reflective floor texture and toggles gravity
  let enableReflections = true;   // user toggleable variable that enables rendering reflections
  let autoBursts = true;          // user toggleable variable that enables automatic bursts
  let _w = innerWidth * window.devicePixelRatio;
  let _h = innerHeight * window.devicePixelRatio;

  let rng = new RNG();
  let renderer = new Renderer(document.getElementById('canvas'));
  let particleGroups = [];
  
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
  let enableReflectionsButton = document.getElementById('enableReflectionsButton');
  let enableFloorButton = document.getElementById('enableFloorButton');
  let persistStrokesButton = document.getElementById('persistStrokesButton');
  let autoBurstButton = document.getElementById('autoBurstButton');
  let clearCanvasButton = document.getElementById('clearCanvasButton');
  let floor = document.getElementsByClassName('floor')[0];

  // just as on the tin for these three; stop immediate propagation in all to prevent particle bursts while clicking a button
  enableReflectionsButton.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    if (!enableFloor) { return; }
    enableReflections = enableReflections ? false : true;
    enableReflectionsButton.classList.toggle('active');
  })

  enableFloorButton.addEventListener('click', (e) => {
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
  })

  persistStrokesButton.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    persistStrokes = persistStrokes ? false : true;
    persistStrokesButton.classList.toggle('active');
    if (!persistStrokes) {
      clearCanvasButton.classList.remove('ready');
    } else {
      clearCanvasButton.classList.add('ready');
    }
  })

  autoBurstButton.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    autoBursts = autoBursts ? false : true;
    newBurstTimer = 0;
    autoBurstButton.classList.toggle('active');
  })

  clearCanvasButton.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    renderer.clear();
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
    particleBurst(e.clientX * window.devicePixelRatio, e.clientY * window.devicePixelRatio);
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

  // push a new particle group onto the list to kick things off
  particleGroups.push(new ParticleGroup(_w / 2, _h / 3, rng.value() * 360));

  function animate(callbackTime) {
    // target 30fps by dividing the time between rAF calls by 30 to calculate per-frame movement
    tempRefreshThrottle = callbackTime - firstFrameTime;
    firstFrameTime = callbackTime || 0;
    refreshThrottle = tempRefreshThrottle / 30;

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
    renderer.render(refreshThrottle);
    window.requestAnimationFrame(animate);
  }

  // at last: init!
  window.requestAnimationFrame(animate);
});