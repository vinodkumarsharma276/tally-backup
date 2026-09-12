import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import { Audiences, Features, HowItWorks, UseCases } from './components/Sections.jsx';
import Roadmap from './components/Roadmap.jsx';
import Faq from './components/Faq.jsx';
import Contact from './components/Contact.jsx';
import Footer from './components/Footer.jsx';
import Download from './components/Download.jsx';
import { product } from './content.js';

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        {product.downloadsEnabled && <Download />}
        <Features />
        <UseCases />
        <HowItWorks />
        <Audiences />
        <Roadmap />
        <Faq />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
