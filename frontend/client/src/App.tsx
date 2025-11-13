import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { useEffect } from "react";
import { useAppDispatch } from "./store/hooks";
import { getCurrentUserThunk } from "./store/thunks/authThunk";
import { TokenManager } from "./services/api";
import Login from "./pages/login";
import Register from "./pages/register";
import ChatPage from "./pages/ChatPage";
import Home from "./pages/home";
import Profile from "./pages/profile";
import ProfilePreview from "./pages/profilePreview";

function ChatRoute() {
  const { id } = useParams();
  if (!id) return <Navigate to="/login" replace />;
  return <ChatPage chatId={id} />;
}

function AppRoutes() {
  const dispatch = useAppDispatch();

  // Restore user from token on app load
  useEffect(() => {
    // Only try to restore if we have a token
    if (TokenManager.access) {
      dispatch(getCurrentUserThunk());
    }
  }, [dispatch]);

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login/>} />
      <Route path="/register" element={<Register/>} />
      <Route path="/chat/:id" element={<ChatRoute/>} />
      <Route path="/home" element={<Home />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/profile/:userId" element={<ProfilePreview />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
