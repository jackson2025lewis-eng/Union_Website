document.addEventListener('DOMContentLoaded', () => {
    // Mobile menu toggle
    const mobileMenuBtn = document.getElementById('mobile-menu');
    const navLinks = document.querySelector('.nav-links');

    if (mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            
            // Toggle icon between menu and close
            const icon = mobileMenuBtn.querySelector('i');
            if (navLinks.classList.contains('active')) {
                icon.classList.remove('bx-menu');
                icon.classList.add('bx-x');
            } else {
                icon.classList.remove('bx-x');
                icon.classList.add('bx-menu');
            }
        });
    }

    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            
            // Close mobile menu if open
            if(navLinks.classList.contains('active')) {
                navLinks.classList.remove('active');
                const icon = mobileMenuBtn.querySelector('i');
                icon.classList.remove('bx-x');
                icon.classList.add('bx-menu');
            }

            // Scroll to target
            const targetId = this.getAttribute('href');
            if(targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
                
                // Update active class on nav links
                document.querySelectorAll('.nav-links li a').forEach(link => {
                    link.classList.remove('active');
                });
                this.classList.add('active');
            }
        });
    });

    // Simple scroll animation using Intersection Observer
    const animateElements = document.querySelectorAll('.feature-card, .about-left, .about-right, .hero-left, .hero-image-wrapper');
    
    // Add initial styles for animation
    animateElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    animateElements.forEach(el => observer.observe(el));

    // Hero Image Slider Logic
    const sliderContainer = document.getElementById('hero-slider-container');
    const sliderTrack = document.getElementById('heroSlider');
    let currentSlideIndex = 0;
    const totalSlides = document.querySelectorAll('.slide-image').length;
    let slideInterval = null;

    function nextHeroSlide() {
        if(totalSlides === 0) return;
        currentSlideIndex = (currentSlideIndex + 1) % totalSlides;
        const slidePercentage = -(currentSlideIndex * 100);
        sliderTrack.style.transform = `translateX(${slidePercentage}%)`;
    }

    function startHeroSlider() {
        if (!slideInterval) {
            slideInterval = setInterval(nextHeroSlide, 2500); // changes every 2.5s
        }
    }

    function stopHeroSlider() {
        if (slideInterval) {
            clearInterval(slideInterval);
            slideInterval = null;
        }
    }

    if (sliderTrack && sliderContainer) {
        // Desktop vs Mobile behavior
        function setupSliderEvent() {
            if (window.innerWidth <= 768) {
                // Mobile: automatic slide
                startHeroSlider();
                sliderContainer.removeEventListener('mouseenter', startHeroSlider);
                sliderContainer.removeEventListener('mouseleave', stopHeroSlider);
            } else {
                // Desktop: hover to slide
                stopHeroSlider(); 
                sliderContainer.addEventListener('mouseenter', startHeroSlider);
                sliderContainer.addEventListener('mouseleave', stopHeroSlider);
            }
        }
        
        setupSliderEvent();
        window.addEventListener('resize', setupSliderEvent);
    }
});
