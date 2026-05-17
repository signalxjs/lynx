import '@sigx/lynx-daisyui/styles';
import './styles.css';
import { defineApp } from '@sigx/lynx';
import App from './App';

defineApp(<App />).mount(null);

if ((module as any).hot) {
    (module as any).hot.accept();
}
