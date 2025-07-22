// NodeDaemon Website Interactive Features

document.addEventListener('DOMContentLoaded', function() {
    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Add terminal typing effect
    function typeCommand(element, text, speed = 50) {
        let i = 0;
        element.textContent = '';
        
        function type() {
            if (i < text.length) {
                element.textContent += text.charAt(i);
                i++;
                setTimeout(type, speed);
            }
        }
        
        type();
    }

    // Animate stats on scroll
    const observerOptions = {
        threshold: 0.5,
        rootMargin: '0px'
    };

    const statsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-fade-in');
                
                // Animate numbers
                const numberElements = entry.target.querySelectorAll('[data-count]');
                numberElements.forEach(el => {
                    const target = parseInt(el.getAttribute('data-count'));
                    animateNumber(el, target);
                });
            }
        });
    }, observerOptions);

    // Observe stats section
    const statsSection = document.querySelector('#stats');
    if (statsSection) {
        statsObserver.observe(statsSection);
    }

    // Number animation function
    function animateNumber(element, target) {
        let current = 0;
        const increment = target / 50;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                current = target;
                clearInterval(timer);
            }
            element.textContent = Math.floor(current);
        }, 20);
    }

    // Copy to clipboard functionality
    function addCopyButton(codeBlock) {
        const button = document.createElement('button');
        button.textContent = 'Copy';
        button.className = 'copy-button absolute top-2 right-2 px-3 py-1 text-xs bg-gray-700 text-white rounded hover:bg-gray-600 transition';
        
        button.addEventListener('click', () => {
            const code = codeBlock.textContent;
            navigator.clipboard.writeText(code).then(() => {
                button.textContent = 'Copied!';
                setTimeout(() => {
                    button.textContent = 'Copy';
                }, 2000);
            });
        });
        
        codeBlock.parentElement.style.position = 'relative';
        codeBlock.parentElement.appendChild(button);
    }

    // Add copy buttons to all code blocks
    document.querySelectorAll('pre code').forEach(addCopyButton);

    // Mobile menu close on link click
    const mobileMenuLinks = document.querySelectorAll('[x-data] a');
    mobileMenuLinks.forEach(link => {
        link.addEventListener('click', () => {
            // Close mobile menu
            const mobileMenuButton = document.querySelector('[x-data] button');
            if (mobileMenuButton && window.innerWidth < 768) {
                mobileMenuButton.click();
            }
        });
    });

    // Add loading state for external links
    document.querySelectorAll('a[target="_blank"]').forEach(link => {
        link.addEventListener('click', function() {
            this.classList.add('loading');
            setTimeout(() => {
                this.classList.remove('loading');
            }, 1000);
        });
    });

    // Feature cards hover effect
    document.querySelectorAll('[x-data] > div > div').forEach(card => {
        card.classList.add('feature-card');
    });

    // Lazy load images
    const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                    imageObserver.unobserve(img);
                }
            }
        });
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
        imageObserver.observe(img);
    });

    // Add keyboard navigation
    document.addEventListener('keydown', (e) => {
        // Press '/' to focus search (if implemented)
        if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const searchInput = document.querySelector('#search');
            if (searchInput) {
                searchInput.focus();
            }
        }
        
        // Press 'g' then 'h' to go home
        if (e.key === 'g') {
            window.addEventListener('keydown', function goHome(e2) {
                if (e2.key === 'h') {
                    window.location.href = '/';
                }
                window.removeEventListener('keydown', goHome);
            });
        }
    });

    // Performance monitoring
    if ('performance' in window) {
        window.addEventListener('load', () => {
            const perfData = performance.getEntriesByType('navigation')[0];
            console.log('Page load time:', perfData.loadEventEnd - perfData.loadEventStart, 'ms');
        });
    }

    // Service worker registration (if needed for offline support)
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // Service worker registration failed, app will work normally
        });
    }
});

// Alpine.js components
document.addEventListener('alpine:init', () => {
    Alpine.data('terminal', () => ({
        commands: [
            'nodedaemon daemon -d',
            'nodedaemon start app.js --name myapp --instances 4',
            'nodedaemon list',
            'nodedaemon logs myapp --follow'
        ],
        currentCommand: 0,
        
        nextCommand() {
            this.currentCommand = (this.currentCommand + 1) % this.commands.length;
        },
        
        prevCommand() {
            this.currentCommand = (this.currentCommand - 1 + this.commands.length) % this.commands.length;
        }
    }));
});