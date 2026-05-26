import { DevServiceWorkerReset } from '@green/components/DevServiceWorkerReset';
import { GreenDesktopResizeHandles } from '@green/components/GreenDesktopResizeHandles';
import { ToastContainer } from '@green/components/toast';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import LoginCallbackPage from './pages/LoginCallbackPage';
import LoginInvitationPage from './pages/LoginInvitationPage';
import LoginPage from './pages/LoginPage';
import OAuthAuthTestPage from './pages/OAuthAuthTestPage';
import OAuthAuthorizeTestPage from './pages/OAuthAuthorizeTestPage';
import PostLoginRedirect from './pages/PostLoginRedirect';

export default function App() {
  return (
    <BrowserRouter>
      <DevServiceWorkerReset />
      <Routes>
        <Route path="/" element={<PostLoginRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/callback" element={<LoginCallbackPage />} />
        <Route path="/login/invitation" element={<LoginInvitationPage />} />
        <Route path="/login/auth-test" element={<OAuthAuthTestPage />} />
        <Route path="/login/authorize-test" element={<OAuthAuthorizeTestPage />} />
        <Route path="*" element={<PostLoginRedirect />} />
      </Routes>
      <ToastContainer />
      <GreenDesktopResizeHandles />
    </BrowserRouter>
  );
}
