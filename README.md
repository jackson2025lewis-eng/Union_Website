# Liberian Students Union in Odisha (LSUO) - Official Website

Welcome to the official repository for the "LIBERIAN STUDENT UNION IN ODISHA (LSUO)" website. This project serves as the digital home for the union, providing information on local chapters, announcements, history, and distinguished alumni. 

# PROJECT STRUCTURE

The website is built using a lightweight, static HTML/CSS architecture, ensuring maximum performance, fast loading times, and straightforward hosting on platforms like Vercel and GitHub Pages.

```
/Union_Website
│
├── index.html                  # Home page (Hero, Announcements, Overview)
├── about.html                  # History, Timeline, and Values of LSUO
├── alumni.html                 # Distinguished Alumni Slider
├── contact.html                # Contact Information and Social Links
│
├── soa-leadership.html         # SOA Chapter leadership & history
├── cv-raman-leadership.html    # CV Raman Chapter leadership & history
├── kiit-leadership.html        # KIIT Chapter leadership & history
│
├── style.css                   # Main responsive stylesheet used across all pages
├── styles.css                  # (Legacy/Backup stylesheet)
└── assets/                     # Images, logos, and media files
```

# CURRENT STATUS OF THE WEBSITE 

The website is currently in a highly polished, production-ready state. Recent milestones achieved include:

1. **Modern UI/UX Design**: Implemented a professional aesthetic using a harmonious blue, white, and red color scheme. Added custom micro-interactions, hover states, and smooth CSS transitions.

2. **Complete Mobile Responsiveness**: Thoroughly audited and fixed layout bugs for mobile devices. 
   - Utilized fluid typography and padding (`clamp()`) to ensure text and spacing adapt perfectly to any screen size.

   - Fixed CSS Grid "blowouts" using `minmax(0, 1fr)` to prevent long text or images from stretching beyond the viewport.

   - Removed rigid aspect ratios to allow cards to grow naturally with their content, completely eliminating overlapping text on small screens.

3. **Navigation**: Built a robust, mobile-friendly sidebar navigation system with a hamburger toggle and dropdown menus for local chapters.

4. **Content Integration**: Successfully laid out and styled the core pages, including complex components like the Alumni Carousel, the History Timeline grid, and the responsive Announcements section.

# IMPROVEMENTS NEEDED

While the site is visually complete and responsive, there are several technical and functional enhancements planned for the future:

1. **Dynamic Content Management**: 
   - *Current*: Adding new announcements or alumni requires manually editing HTML code.

2. **Contact Form Backend**:
   - *Current*: The contact page relies on direct `mailto:` links.
   - *Improvement*: Implement a functional contact form utilizing a service like Forms to allow users to send messages directly from the website without opening their email client.
3. **SEO & Social Sharing Optimization**:
   - Add Open Graph (`og:`) and Twitter Card meta tags to all HTML pages so that links shared on WhatsApp, Facebook, and LinkedIn generate beautiful preview cards with images and descriptions.
4. **Media Optimization**:
   - Convert all existing `.jpg` and `.png` assets in the `assets/` folder to modern `.webp` formats to save bandwidth.
   - Implement `loading="lazy"` on all gallery and timeline images to improve initial page load speed.
5. **Accessibility (a11y) Polish**:
   - Perform a final WCAG accessibility audit to ensure all color contrasts are optimal, and that all interactive elements (carousels, dropdowns) are fully navigable via keyboard and screen readers.

## 💻 Local Development

To run this project locally, simply clone the repository and open any of the HTML files in your browser. No build steps or complex local servers are required!

For a better experience (to prevent CORS issues with local fonts/assets), you can use the Live Server extension in VS Code, or run a simple Python server:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000` in your browser.
