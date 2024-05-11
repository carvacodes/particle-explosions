window.addEventListener('load', ()=>{
let canvas = document.getElementById('canvas');
let ctx = canvas.getContext('2d');

// set the canvas width and height to the screen width and height
canvas.width = innerWidth;
canvas.height = innerHeight;

// and set the canvas width/height to new window width/height when it's resized
window.addEventListener('resize',function(){
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  particles = []; // empty out the particles array on resize to avoid any artifacting (there are more elegant ways to do this, but this works)
});


/////////////////////
//     Globals     //
/////////////////////
let gravity = .6;
let friction = 0.999;         // this restricts particle movement along the X and Z axes just a touch, subtly imparting a more natural appearance
let particlesPerBlast = 60;   // 60 is a reasonable size for the number of particles; straddles the line between boring to see and rough to process
let newBlast = 0;             // the timer that will allow new particle bursts to form automatically
let reflectThreshold = 300;   // the threshold for when reflections will appear on the ground
let drawStrokes = true;       // user toggleable variable for whether to draw particles with rectangles at the particle's position or draw strokes between the particle's last x/y and current x/y positions
let persistCanvas = false;    // user toggleable variable that controls whether to clearRect() the canvas every frame, resulting in either discrete particles or streaming lines
let enableFloor = true;         // user toggleable variable that shows or hides the reflective floor pattern (a fixed position div)
let particles = [];           // holds the particle objects and is iterated through on every frame

/////////////////////
//    Listeners    //
/////////////////////
// on every click, create a particle burst at that position
document.addEventListener('click',function(e){
  e.preventDefault();
  populate(particles, e.clientX, e.clientY, Math.round(Math.random() * 360));
  newBlast = 120;
})

// get the relevant button objects
let drawStrokesButton = document.getElementById('drawStrokesButton');
let enableFloorButton = document.getElementById('enableFloorButton');
let persistCanvasButton = document.getElementById('persistCanvasButton');
let floor = document.getElementsByClassName('floor')[0];

// just as on the tin for these three; stop immediate propagation in all to prevent particle bursts while clicking a button
drawStrokesButton.addEventListener('click', (e) => {
  e.stopImmediatePropagation();
  drawStrokes = drawStrokes ? false : true;
  drawStrokesButton.classList.toggle('active');
})

enableFloorButton.addEventListener('click', (e) => {
  e.stopImmediatePropagation();
  enableFloor = enableFloor ? false : true;
  enableFloorButton.classList.toggle('active');
  floor.style.display = enableFloor ? 'initial' : 'none';
})

persistCanvasButton.addEventListener('click', (e) => {
  e.stopImmediatePropagation();
  persistCanvas = persistCanvas ? false : true;
  persistCanvasButton.classList.toggle('active');
})

//////////////////////////
//    Particle Class    //
//////////////////////////
class Particle {
  constructor(x, y, hue) {
    this.lifetime = 80 + Math.round(Math.random() * 40);  // particles will automatically be culled when their lifetime hits zero
    this.hue = hue;                                       // color variables
    this.lightness = Math.round(50 + Math.random() * 50); // added lightness for more variety
    this.size = Math.random() * 2;                        // controls the stroke or rect size, depending on the particle render type currently chosen
    this.x = x;                                           // position info
    this.y = y;
    this.prevX = this.x;                                  // stores the last position. utilized in particle stroke rendering
    this.prevY = this.y;
    this.z = Math.max((4 * innerHeight / 5) + Math.round(Math.random() * innerHeight / 12), this.y);  // simulates depth (see move/render methods)
    this.xSpeed = 5 + Math.random() * - 10;       // speed variables
    this.ySpeed = 5 + Math.random() * - 10;       // for each axis
    this.zSpeed = 0.4 + Math.random() * - 0.8;    // note that zSpeed is set much lower, as depth changes more subtly/slowly than x/y position
  }

  move() {
    // set prevX/Y before moving for stroke-style rendering
    this.prevX = this.x;
    this.prevY = this.y;
    
    // add x speed straight away
    this.x += this.xSpeed;
    this.xSpeed *= friction;
    
    this.y += this.ySpeed;  // add the ySpeed to the y position

    // the following logic only applies when the floor is enabled
    if (!enableFloor) { return };

    // allow the particle to speed up if its y position hasn't reached its z position; 
    if (this.y < this.z) {
      this.ySpeed = this.ySpeed + (gravity * gravity); 
    }

    // if the y position has reached the z position, bounce (ySpeed * -0.5)
    if (this.y + this.ySpeed >= this.z) {
      this.ySpeed *= -0.5;
    }

    // increase the z position by zSpeed on every frame, but decrease zSpeed by the friction coefficient
    this.z += this.zSpeed;
    this.zSpeed *= friction;
  }

  // draw the particle
  render() {
    // create a shadow underneath the particle
    ctx.shadowColor = `hsl(${this.hue}, 100%, ${this.lightness - 10}%)`;
    ctx.shadowBlur = this.size * 3;

    // if drawStrokes is set, draw a line from prevX/Y to current x/y
    if (drawStrokes) {
      ctx.strokeStyle = `hsl(${this.hue}, 100%, ${this.lightness}%)`;
      ctx.lineWidth = this.size;
      ctx.beginPath();
      ctx.moveTo(this.prevX, this.prevY);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
    } else {  // otherwise, draw a filled rectangle
      ctx.fillStyle = `hsl(${this.hue}, 100%, ${this.lightness}%)`;
      ctx.fillRect(this.x, this.y, this.size, this.size);
    }

    // check height; if within the reflectThreshold, and if enableFloor is true, draw reflections
    let height = this.z - this.y;
    if (height <= reflectThreshold && enableFloor) {
      let heightFalloff = 1 - (height / (reflectThreshold));  // heightFalloff is a ratio for most of these properties; closer to the ground = more effect
      let glowAlpha = heightFalloff * 0.1;  // set the alpha for the floor reflection glow relative to the heightFalloff

      // fill style can be set using glowAlpha right away
      ctx.fillStyle = `hsla(${this.hue}, 100%, 100%, ${glowAlpha})`;

      // draw an arc, elongated in the x axis and squished in the y axis
      ctx.beginPath();
      let radius = Math.max(this.size * 3 * heightFalloff, 0); // Arc radius
      let startAngle = 0; 
      let endAngle = Math.PI * 2;
      ctx.ellipse(this.x + this.size / 4, Math.max(this.y, this.z) + this.size, radius, radius * 0.33, 0, startAngle, endAngle);
      ctx.fill();
    }
  }
}

// populate the particles array with particles
function populate(arr, ex, ey, hue) {
  for (let i = 0; i < particlesPerBlast; i++) {
    arr.push(new Particle(ex, ey, hue));
  }
}

// procedurally generate particles if the user isn't interacting
function autoPopulate() {
  populate(particles,
           100 + Math.round(Math.random() * (innerWidth - 200)),
           Math.random() * 2 * innerHeight / 5 + (innerHeight / 5),
           Math.round(Math.random() * 360));
  newBlast = 60;
}

// currentTime (and the frameTime var within the animate() function) caps the frame rate at 60fps
let currentTime = Date.now();

function animate() {
  // if fewer than 16 ms have passed, that would be more than 60fps; exit immediately by requesting another animation frame
  let frameTime = Date.now();
  if (frameTime - currentTime < 16) {
    window.requestAnimationFrame(animate);
    return; // return for safety and code sanity
  }
  
  currentTime = frameTime;  // start the frame timer from the new current time
  
  // if the newBlast timer has reached zero, autopopulate
  if (newBlast > 0) {
    newBlast--;
  }
  if (newBlast <= 0) {
    autoPopulate();
  }

  // if not persisting the canvas, blank it out
  if (!persistCanvas) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  }
  
  // loop through every particle in the particles array and operate on it
  for (let i = 0; i < particles.length; i++) {
    let p = particles[i];
    
    if (p.lifetime > 0) {
      p.move();
      p.render();
    } else {
      particles.splice(i, 1);
    }
    p.lifetime--;
  }

  // get the next animation frame
  window.requestAnimationFrame(animate);
}

// at last: init!
animate();
});