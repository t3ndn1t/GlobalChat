/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  addDoc, 
  setDoc,
  doc,
  deleteDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import { Send, LogOut, MessageSquare, User as UserIcon, Loader2, Check, CheckCheck, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatMessage {
  id: string;
  text: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  createdAt: Timestamp | null;
  status?: 'sending' | 'sent' | 'error';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<{id: string, userName: string}[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        status: 'sent'
      })) as ChatMessage[];
      setMessages(msgs.reverse());
      
      // Clear pending messages that have been confirmed by the server
      setPendingMessages(prev => prev.filter(p => !msgs.some(m => m.text === p.text && m.userId === p.userId)));
    }, (error) => {
      console.error("Firestore error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, 'typing'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const typing = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as any))
        .filter(t => t.id !== user.uid && t.isTyping)
        .map(t => ({ id: t.id, userName: t.userName }));
      setTypingUsers(typing);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error.code === 'auth/cancelled-popup-request') {
        console.log("Sign in popup was closed or preempted.");
      } else {
        console.error("Sign in error:", error);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = () => signOut(auth);

  const updateTypingStatus = async (isTyping: boolean) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'typing', user.uid), {
        isTyping,
        userName: user.displayName || 'Anonymous',
        lastActive: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("Error updating typing status:", error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    if (!user) return;

    updateTypingStatus(true);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      updateTypingStatus(false);
    }, 3000);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user || sending) return;

    const text = newMessage.trim();
    const tempId = Math.random().toString(36).substring(7);
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    updateTypingStatus(false);
    const optimisticMsg: ChatMessage = {
      id: tempId,
      text,
      userId: user.uid,
      userName: user.displayName || 'Anonymous',
      userPhoto: user.photoURL || undefined,
      createdAt: null,
      status: 'sending'
    };

    setPendingMessages(prev => [...prev, optimisticMsg]);
    setNewMessage('');
    
    try {
      await addDoc(collection(db, 'messages'), {
        text,
        userId: user.uid,
        userName: user.displayName || 'Anonymous',
        userPhoto: user.photoURL,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Send error:", error);
      setPendingMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'error' } : m));
    }
  };

  const allMessages = [...messages, ...pendingMessages];

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center border border-emerald-500/20">
              <MessageSquare className="w-10 h-10 text-emerald-500" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-white tracking-tight">Global Chat</h1>
            <p className="text-zinc-400">Connect with people around the world in real-time.</p>
          </div>
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full py-4 px-6 bg-white text-black font-semibold rounded-2xl hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-3"
          >
            {signingIn ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" referrerPolicy="no-referrer" />
            )}
            {signingIn ? 'Signing in...' : 'Sign in with Google'}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="h-16 border-bottom border-zinc-800 bg-zinc-900/50 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-black" />
          </div>
          <span className="font-bold text-lg tracking-tight">Global Chat</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 rounded-full border border-zinc-700">
            {user.photoURL ? (
              <img src={user.photoURL} className="w-6 h-6 rounded-full" alt="" referrerPolicy="no-referrer" />
            ) : (
              <UserIcon className="w-4 h-4" />
            )}
            <span className="text-sm font-medium max-w-[100px] truncate">{user.displayName}</span>
          </div>
          <button 
            onClick={handleSignOut}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-all"
            title="Sign Out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <main 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto w-full scroll-smooth"
      >
        <AnimatePresence initial={false}>
          {allMessages.map((msg) => {
            const isMe = msg.userId === user.uid;
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className={cn(
                  "flex gap-3 group",
                  isMe ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div className="flex-shrink-0 mt-1">
                  {msg.userPhoto ? (
                    <img src={msg.userPhoto} className="w-8 h-8 rounded-full border border-zinc-800 shadow-sm" alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700 shadow-sm">
                      <UserIcon className="w-4 h-4 text-zinc-500" />
                    </div>
                  )}
                </div>
                
                <div className={cn(
                  "flex flex-col gap-1.5 max-w-[75%]",
                  isMe ? "items-end" : "items-start"
                )}>
                  {!isMe && (
                    <span className="text-[11px] font-semibold text-zinc-500 ml-1 uppercase tracking-wider">
                      {msg.userName}
                    </span>
                  )}
                  <div className={cn(
                    "px-4 py-3 rounded-2xl text-[15px] leading-relaxed shadow-lg transition-all duration-200",
                    isMe 
                      ? "bg-emerald-500 text-black font-medium rounded-tr-none hover:bg-emerald-400" 
                      : "bg-zinc-800 text-zinc-100 rounded-tl-none border border-zinc-700 hover:bg-zinc-700/80"
                  )}>
                    {msg.text}
                  </div>
                  
                  <div className={cn(
                    "flex items-center gap-1.5 px-1",
                    isMe ? "flex-row-reverse" : "flex-row"
                  )}>
                    <span className="text-[10px] font-medium text-zinc-600">
                      {msg.createdAt ? format(msg.createdAt.toDate(), 'HH:mm') : 'Sending...'}
                    </span>
                    
                    {isMe && (
                      <div className="flex items-center">
                        {msg.status === 'sending' && (
                          <Loader2 className="w-3 h-3 text-zinc-600 animate-spin" />
                        )}
                        {msg.status === 'sent' && (
                          <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        )}
                        {msg.status === 'error' && (
                          <div className="flex items-center gap-1 text-red-500">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span className="text-[9px] font-bold uppercase">Failed</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        
        {typingUsers.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-zinc-500 text-xs font-medium pl-1"
          >
            <div className="flex gap-1">
              <span className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
            <span>
              {typingUsers.length === 1 
                ? `${typingUsers[0].userName} is typing...`
                : `${typingUsers.length} people are typing...`}
            </span>
          </motion.div>
        )}
      </main>

      {/* Input */}
      <footer className="p-6 bg-zinc-950 border-top border-zinc-800 sticky bottom-0">
        <form 
          onSubmit={handleSendMessage}
          className="max-w-4xl mx-auto relative"
        >
          <input
            type="text"
            value={newMessage}
            onChange={handleInputChange}
            placeholder="Type a message..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all text-zinc-100 placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || sending}
            className="absolute right-2 top-2 bottom-2 px-4 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 transition-all flex items-center justify-center"
          >
            {sending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </form>
      </footer>
    </div>
  );
}
