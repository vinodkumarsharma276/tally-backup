import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import { Audiences, Features, HowItWorks, UseCases } from './components/Sections.jsx';
import Roadmap from './components/Roadmap.jsx';
import Faq from './components/Faq.jsx';
import Contact from './components/Contact.jsx';
import Footer from './components/Footer.jsx';

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
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
