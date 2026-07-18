// Premium Wave Particle System for Artivy
const container = document.getElementById('canvas-container');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000);
// Position camera higher up and looking down at the wave
camera.position.set(0, 50, 100);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// Create Particle Wave
const SEPARATION = 4, AMOUNTX = 60, AMOUNTY = 60;
let count = 0;
const numParticles = AMOUNTX * AMOUNTY;

const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(numParticles * 3);
const colors = new Float32Array(numParticles * 3);
const scales = new Float32Array(numParticles);

// Use brand colors for particles: #ff6b6b (coral) and #4ecdc4 (teal)
const color1 = new THREE.Color(0xff6b6b);
const color2 = new THREE.Color(0x4ecdc4);

let i = 0;
for (let ix = 0; ix < AMOUNTX; ix++) {
    for (let iy = 0; iy < AMOUNTY; iy++) {
        // Positions
        positions[i * 3] = ix * SEPARATION - ((AMOUNTX * SEPARATION) / 2); // x
        positions[i * 3 + 1] = 0; // y (will be animated)
        positions[i * 3 + 2] = iy * SEPARATION - ((AMOUNTY * SEPARATION) / 2); // z
        
        // Interpolate colors based on X and Z position
        const mixRatio = (ix / AMOUNTX) * 0.5 + (iy / AMOUNTY) * 0.5;
        const mixedColor = color1.clone().lerp(color2, mixRatio);
        
        colors[i * 3] = mixedColor.r;
        colors[i * 3 + 1] = mixedColor.g;
        colors[i * 3 + 2] = mixedColor.b;
        
        scales[i] = 1;
        
        i++;
    }
}

geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
geometry.setAttribute('scale', new THREE.BufferAttribute(scales, 1));

// Custom Shader Material for scaled particles with colors
const material = new THREE.ShaderMaterial({
    uniforms: {
        color: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: `
        attribute float scale;
        varying vec3 vColor;
        void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = scale * (50.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        varying vec3 vColor;
        void main() {
            // make it circular
            if (length(gl_PointCoord - vec2(0.5, 0.5)) > 0.475) discard;
            gl_FragColor = vec4(vColor, 0.8);
        }
    `,
    transparent: true,
    vertexColors: true
});

const particles = new THREE.Points(geometry, material);
scene.add(particles);

// Mouse interaction
let mouseX = 0;
let mouseY = 0;
const windowHalfX = window.innerWidth / 2;
const windowHalfY = window.innerHeight / 2;

document.addEventListener('mousemove', (event) => {
    mouseX = event.clientX - windowHalfX;
    mouseY = event.clientY - windowHalfY;
});

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    // Camera gently follows mouse
    camera.position.x += (mouseX * 0.05 - camera.position.x) * 0.05;
    camera.position.y += (-mouseY * 0.05 + 50 - camera.position.y) * 0.05;
    camera.lookAt(scene.position);

    const positions = particles.geometry.attributes.position.array;
    const scales = particles.geometry.attributes.scale.array;

    let i = 0;
    for (let ix = 0; ix < AMOUNTX; ix++) {
        for (let iy = 0; iy < AMOUNTY; iy++) {
            // Complex wave function
            positions[i * 3 + 1] = (Math.sin((ix + count) * 0.3) * 5) +
                                   (Math.sin((iy + count) * 0.5) * 5);
            
            // Pulse size based on wave height
            scales[i] = (Math.sin((ix + count) * 0.3) + 1) * 1.5 +
                        (Math.sin((iy + count) * 0.5) + 1) * 1.5;
            
            i++;
        }
    }
    
    particles.geometry.attributes.position.needsUpdate = true;
    particles.geometry.attributes.scale.needsUpdate = true;
    
    count += 0.05;

    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
