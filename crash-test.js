console.log('Crash test started - will crash in 3 seconds');

let counter = 0;

const timer = setInterval(() => {
  counter++;
  console.log(`Running for ${counter} seconds...`);
  
  if (counter >= 3) {
    console.log('Crashing now!');
    clearInterval(timer);
    throw new Error('Intentional crash for testing');
  }
}, 1000);