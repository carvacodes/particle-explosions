window.addEventListener('load', ()=>{
  /*******************************************************************************/
  /*                                   Classes                                   */
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
    stepParticles(frameDuration) {
      let continueRendering = false;

      for (let i = 0; i < this.particles.length; i++) {
        let particle = this.particles[i];
        if (particle.lifetime > 0 ) {
          if (!continueRendering) { continueRendering = true; }
          particle.move(frameDuration);
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
      this.lifetime;        // the particle's lifetime decrements by one at every move() call, and it is skipped for processing and rendering if lifetime <= 0
      this.lightness;       // handles the individual coloration of a particle (since its hue is managed by its parent particleGroup)
      this.size;            // the weight of the particle, which ends up being its lineWidth in context.stroke operations

      this.resetValues();   // this immediately sets any values that are not initialized with values to something random
    }

    // resets and re-randomizes the particle's values. used at instantiation and when the parent particleGroup moves
    resetValues() {
      this.lifetime = 80 + Math.round(rng.value() * 40);  // particles will automatically be culled when their lifetime hits zero
      this.lightness = Math.round(60 + rng.value() * 40); // added lightness for more variety
      this.size = Math.ceil(rng.value() * 2);                        // controls the stroke or rect size, depending on the particle render type currently chosen
      this.z = Math.max((4 * innerHeight / 5) + Math.round(rng.value() * innerHeight / 12), this.y);  // simulates depth (see move/render methods)
      this.xSpeed = 5 + rng.value() * - 10;       // speed variables
      this.ySpeed = 5 + rng.value() * - 10;       // for each axis
      this.zSpeed = 0.4 + rng.value() * - 0.8;    // note that zSpeed is set much lower, as depth changes more subtly/slowly than x/y position
      this.prevX = this.x;
      this.prevY = this.y;
      this.prevZ = this.z;
    }

    // move functions for the particle. the amount of movement is adjusted by the last requestAnimationFrame call's duration.
    move(frameDuration) {
      // target 16.667ms/frame for speeds. this frameSpeedFactor will change how much each speed and position variable changes,
      // which should help ensure a more consistent experience across devices and browsers
      let frameSpeedFactor = frameDuration / 16.667;

      // lifetime can be handled first, since it will always change
      this.lifetime -= 1 * frameSpeedFactor;

      // immediately stop rendering or processing any particles outside the viewport
      if (this.x < 0 || this.x > innerWidth || this.y > innerHeight) {
        this.lifetime = -1;
      }

      // set prevX/Y before moving for stroke-style rendering
      this.prevX = this.x;
      this.prevY = this.y;
      this.prevZ = this.z;
      // add x speed straight away
      this.x += this.xSpeed * frameSpeedFactor;
      this.xSpeed *= enableFloor ? friction : 1;
      
      this.y += this.ySpeed * frameSpeedFactor;  // add the ySpeed to the y position

      // z-position logic only applies when the floor is enabled; return here if floors aren't enabled
      if (!enableFloor) { return };

      // allow the this to speed up if its y position hasn't reached its z position; 
      if (this.y < this.z) {
        this.ySpeed = this.ySpeed + (gravity * gravity * frameSpeedFactor); 
      }

      // if the y position has reached the z position, bounce (ySpeed * -0.5)
      if (this.y + this.ySpeed > this.z) {
        this.y = this.z;
        this.ySpeed *= -0.5;
      }

      // increase the z position by zSpeed on every frame, but decrease zSpeed by the friction coefficient
      this.z += this.zSpeed * frameSpeedFactor;
      this.zSpeed *= friction;
    }
  }

  //////////////////////////
  //    Renderer Class    //
  //////////////////////////
  // handles drawing functions for particle groups and particles. contains the canvas and context that will be used for drawing
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = this.canvas.getContext('2d');
      this.renderQueue = [];

      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }

    // clears the screen every frame. called only if "persist strokes" is off (as dictated within the animation frame logic)
    clear() {
      this.ctx.clearRect(0, 0, innerWidth, innerHeight);
    }

    // a helper method that gathers particle groups into a queue to be rendered, instead of looping over all particle groups (and particles) every time
    enqueue(groupToRender) {
      this.renderQueue.push(groupToRender);
    }

    // draws particle groups that are currently rendering
    render() {
      while (this.renderQueue.length > 0) {
        // shift the particleGroup off the render queue. this method exits when the render queue is empty
        let pGroup = this.renderQueue.pop();

        // create a shadow underneath the particle
        this.ctx.shadowBlur = 3;
        this.ctx.shadowColor = `hsl(${pGroup.hue}, 100%, 85%)`;

        // loop through the queued group's particles
        for (let j = 0; j < pGroup.particles.length; j++) {
          let particle = pGroup.particles[j];
          this.ctx.lineWidth = particle.size;
          
          if (particle.lifetime > 0) {
            // draw reflections first
            // check height; if within the reflectThreshold, and if enableFloor is true, draw reflections
            let height = Math.abs(particle.z - particle.y);
            if (enableFloor && enableReflections && height < reflectThreshold) {
              let heightFalloff = 1 - (height / (reflectThreshold));  // heightFalloff is a ratio for most of these properties; closer to the ground = more effect
              this.ctx.strokeStyle = `hsla(${pGroup.hue}, 100%, ${particle.lightness}%, ${0.4 * heightFalloff * heightFalloff})`;
              
              // draw the reflection based on the reflected point's distance from the particle's z-position
              this.ctx.beginPath();
              this.ctx.moveTo(particle.prevX, particle.prevY + (particle.prevZ - particle.prevY) * 2);
              this.ctx.lineTo(particle.x, particle.y + (particle.z - particle.y) * 2);
              this.ctx.stroke();
            }

            // draw particles themselves next. particles are drawn after reflections to ensure that actual particle graphics are prioritized
            this.ctx.beginPath();
            this.ctx.strokeStyle = `hsl(${pGroup.hue}, 100%, ${particle.lightness}%)`;
    
            // if drawStrokes is set, draw a line from prevX/Y to current x/y
            this.ctx.moveTo(particle.prevX, particle.prevY);
            this.ctx.lineTo(particle.x, particle.y);
            this.ctx.stroke();
          }
        }
      }
    }
  }

  /*******************************************************************************/
  /*                                   Globals                                   */
  /*******************************************************************************/
  
  let gravity = 0.6;              // pretty self-explanatory, but this feels like a good value
  let friction = 0.999;           // this restricts particle movement along the X and Z axes just a touch, subtly imparting a more natural appearance
  let particlesPerBlast = 60;     // 60 is a reasonable size for the number of particles; straddles the line between boring to see and rough to process
  let newBurstTimer = 60;         // the timer that will allow new particle bursts to form automatically
  let reflectThreshold = 300;     // the threshold for when reflections will appear on the ground
  let persistStrokes = false;     // user toggleable variable that controls whether to clearRect() the canvas every frame, resulting in either discrete particles or streaming lines
  let enableFloor = true;         // user toggleable variable that shows or hides the reflective floor texture and toggles gravity
  let enableReflections = true;   // user toggleable variable that enables rendering reflections
  let autoBursts = true;          // user toggleable variable that enables automatic bursts

  let rng = new RNG();
  let renderer = new Renderer(document.getElementById('canvas'));
  let particleGroups = [];
  
  /*******************************************************************************/
  /*                                  Listeners                                  */
  /*******************************************************************************/
  // on every click, create a particle burst at that position
  document.addEventListener('mousedown', createParticleBurst);
  document.addEventListener('touchstart', createParticleBurst, {passive: false});
  document.addEventListener('touchmove', (e) => {e.preventDefault()}, {passive: false});

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
  /*                                  Functions                                  */
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
    if (e.changedTouches) {
      e = e.touches[0];
    }
    if (e.target.tagName == 'BUTTON') {
      return;
    }
    particleBurst(e.clientX, e.clientY);
    newBurstTimer = 120;
  }

  // procedurally generate particles if the user isn't interacting
  function autoPopulate() {
    particleBurst(100 + (rng.value() * (innerWidth / 2)) + (innerWidth / 4),
                  100 + (rng.value() * (2 * innerHeight / 3)),
                  rng.value() * 360);
    newBurstTimer = 60;
  }

  
  /*******************************************************************************/
  /*                               Animation Loop                                */
  /*******************************************************************************/

  // currentTime (and the frameTime var within the animate() function) caps the frame rate at 60fps
  let lastFrameStart = document.timeline.currentTime;
  particleGroups.push(new ParticleGroup(innerWidth / 2, innerHeight / 3, rng.value() * 360));

  function animate(lastCallbackTime) {
    // prepare the next animation frame
    window.requestAnimationFrame(animate);

    const frameTime = lastCallbackTime - lastFrameStart;
    lastFrameStart = lastCallbackTime;
    
    // if the user has autoburst enabled
    if (autoBursts) {
      // if the newBurstTimer timer has reached zero, autopopulate
      if (newBurstTimer > 0) {
        newBurstTimer--;
      }
      if (newBurstTimer <= 0) {
        autoPopulate();
        newBurstTimer = 60 / (frameTime / 16.667);  // makes sure the timer goes off once per second (after roughly 60 frames)
      }
    }

    // clear the canvas if persist stroke is off
    if (!persistStrokes) { renderer.clear(); }
        
    // loop particleGroups
    for (let i = 0; i < particleGroups.length; i++) {
      let pGroup = particleGroups[i];
      // if a particle group is still rendering (it has at least one particle with a lifetime > 0), update its particles' positions and queue it for rendering
      if (pGroup.rendering) {
        pGroup.stepParticles(frameTime);
        pGroup.queueForRender(renderer);
        renderFrame = true;
      }
    }

    // let the renderer run
    renderer.render();

  }

  // at last: init!
  animate();
});