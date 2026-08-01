/**
 * Sidebar Minimap / Scroll Tracker
 * Tracks the active section in the viewport and sets .active on the corresponding sidebar link.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Fix Random Scroll on Open
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
    window.scrollTo(0, 0);

    const nav = document.querySelector('.kit-nav');
    // Ensure nav is positioned for offset calculations
    if (getComputedStyle(nav).position === 'static') {
        nav.style.position = 'relative'; 
    }

    const sections = document.querySelectorAll('section[id], .kit-heading[id]'); 
    
    // Intersection Observer for scroll spying
    const observerOptions = {
        root: null,
        // Active zone: trigger when section hits 20% from top, leave when 80% gone
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0.01 // >0 reduces callback frequency in Firefox vs threshold:0
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                setActiveLink(entry.target.id);
            }
        });
    }, observerOptions);

    sections.forEach(section => observer.observe(section));
    
    // Handle Click
    nav.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') {
            const href = e.target.getAttribute('href');
            if (href.startsWith('#')) {
                // Manually set active immediately for responsiveness
                const id = href.substring(1);
                setActiveLink(id);
            }
        }
    });

    function setActiveLink(id) {
        if (!id) return;
        
        nav.querySelectorAll('a').forEach(a => a.classList.remove('active'));
        const activeLink = nav.querySelector(`a[href="#${id}"]`);
        
        if (activeLink) {
            activeLink.classList.add('active');
        }
    }

    function updateHighlightPosition(link) {
        // 2. Use offsetTop for stable positioning (avoids scroll conflict)
        // This relies on 'link' being a child of 'nav' (or 'nav' being the offsetParent)
        const top = link.offsetTop;
        const height = link.offsetHeight;
        
        highlight.style.transform = `translateY(${top}px)`;
        highlight.style.height = `${height}px`;
        highlight.style.opacity = '1';

        // 3. Optional: Scroll sidebar if active link is out of view
        keepLinkInView(link);
    }

    function keepLinkInView(link) {
        const navTop = nav.scrollTop;
        const navBottom = navTop + nav.clientHeight;
        const linkTop = link.offsetTop;
        const linkBottom = linkTop + link.offsetHeight;

        // 'smooth' fired during main-view scroll caused a second scroll animation mid-frame — instant only
        if (linkTop < navTop + 20) {
           nav.scrollTo({ top: linkTop - 20, behavior: 'instant' });
        } else if (linkBottom > navBottom - 20) {
           nav.scrollTo({ top: linkBottom - nav.clientHeight + 20, behavior: 'instant' });
        }
    }


});
