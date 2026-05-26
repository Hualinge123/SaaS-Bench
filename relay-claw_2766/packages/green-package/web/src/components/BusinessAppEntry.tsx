'use client';

import { AuthHeroShowcase } from '@green/components/auth/AuthShell';
import { LoadingPointStyle } from '@green/components/LoadingPointStyle';
import { apiFetch } from '@green/utils/api-client';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import MainShell from '@/components/MainShell';
import AgentsPage from '@/pages/AgentsPage';
import ChannelsPage from '@/pages/ChannelsPage';
import HomePage from '@/pages/HomePage';
import ModelsPage from '@/pages/ModelsPage';
import SchedulePage from '@/pages/SchedulePage';
import SkillsPage from '@/pages/SkillsPage';
import ThreadPage from '@/pages/ThreadPage';

type IsLoginResponse = {
  islogin?: boolean;
};

let lastKnownLoginState: boolean | null = null;
let loginCheckInFlight: Promise<boolean> | null = null;

function MainRouteShell() {
  return (
    <MainShell>
      <Outlet />
    </MainShell>
  );
}

function BusinessRoutes() {
  return (
    <Routes>
      <Route element={<MainRouteShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/thread/:threadId" element={<ThreadPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/scheduledTasks" element={<SchedulePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function BusinessAppEntry() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(() => lastKnownLoginState);

  useEffect(() => {
    let cancelled = false;

    const checkLoginStatus = async () => {
      try {
        if (!loginCheckInFlight) {
          loginCheckInFlight = (async () => {
            const response = await apiFetch('/api/islogin');
            const data = (await response.json()) as IsLoginResponse;
            return Boolean(data?.islogin);
          })().finally(() => {
            loginCheckInFlight = null;
          });
        }

        const loginResult = await loginCheckInFlight;
        if (cancelled) return;

        lastKnownLoginState = loginResult;

        if (loginResult) {
          setIsLoggedIn(true);
          return;
        }

        setIsLoggedIn(false);
        window.location.replace('/login');
      } catch (error) {
        console.error('检查登录状态失败:', error);
      }
    };

    void checkLoginStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoggedIn === true) {
    return (
      <BrowserRouter>
        <BusinessRoutes />
      </BrowserRouter>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top_left,_rgba(250,222,197,0.28),_transparent_38%),linear-gradient(135deg,_#FFF8F2_0%,_#FFFFFF_56%,_#FFF4EA_100%)] px-4 py-8 sm:px-6 md:px-8 lg:px-12 lg:py-10 xl:px-16">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1280px] items-center justify-center lg:min-h-[calc(100vh-5rem)]">
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
          <AuthHeroShowcase layout="standalone" />

          <div className="mt-12 flex items-center gap-3 text-[16px] font-normal text-[#595959] sm:text-base">
            <LoadingPointStyle className="h-5 w-5 flex-shrink-0" />
            <span>{isLoggedIn ? '已登录，正在进入首页...' : '加载中...'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
