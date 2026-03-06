// StudentDashboard.jsx

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Threads from './background';
import ChatInterface from './ChatInterface';
import {
    collection,
    getDocs,
    query,
    orderBy,
    doc,
    onSnapshot,
    setDoc
} from 'firebase/firestore';
// IMPORTANT: Ensure logTimeOnNote in '../firebase' uses Firebase.firestore.FieldValue.increment()
import { firestore as db, markNoteComplete, logTimeOnNote } from '../firebase';

// --- CONFIGURATION ---
const COMPLETION_THRESHOLD_SECONDS = 20; // threshold to mark a note "completed"
const MIN_LOG_MINUTES = 0.01; // don't write extremely tiny minute fractions to Firestore

// --- UTILITY FUNCTIONS ---

// Format time to include seconds for real-time visibility
const formatTime = (totalSeconds) => {
    const seconds = Math.floor(totalSeconds);

    if (seconds === 0) {
        return '0s';
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
        return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
};

const formatFileSize = (bytes) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// --- Progress Modal Component ---

const ProgressModal = React.memo(({ progressData, activeNoteId, formatTime, onClose }) => {
    const { totalNotes, completedCount, pendingCount, progressPercentage, trackedNotesList, totalTrackedSeconds } = progressData;

    return (
        <div style={{
            position: 'absolute',
            top: '100%',
            right: '0',
            marginTop: '32px',
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
            zIndex: 99999,
            minWidth: '400px',
            maxWidth: '500px',
            maxHeight: 'calc(100vh - 150px)',
            overflowY: 'auto',
            overflowX: 'hidden'
        }}>
            <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>My Progress </h3>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            fontSize: '20px',
                            cursor: 'pointer',
                            color: '#6b7280',
                            padding: '4px'
                        }}
                        aria-label="Close progress modal"
                    >
                        &times;
                    </button>
                </div>

                {/* Notes Completion Progress Bar */}
                <div style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                        <span>Notes Progress</span>
                        <span>{completedCount}/{totalNotes} (Pending: {pendingCount})</span>
                    </div>
                    <div style={{ width: '100%', height: '12px', background: '#f3f4f6', borderRadius: '999px', overflow: 'hidden' }}>
                        <div
                            style={{
                                width: `${Math.min(100, progressPercentage)}%`,
                                height: '100%',
                                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                            }}
                        />
                    </div>
                    <p style={{ textAlign: 'center', marginTop: '4px', fontSize: '12px', fontWeight: 'bold', color: '#16a34a' }}>{Math.min(100, progressPercentage)}% Complete</p>
                </div>

                

                
            </div>
        </div>
    );
});

// --- Student Dashboard Component ---

function StudentDashboard() {
    const { currentUser, logout } = useAuth();
    const [notes, setNotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showProgressModal, setShowProgressModal] = useState(false);

    // State synced from Firestore via listener
    const [completedNoteIds, setCompletedNoteIds] = useState([]);
    const [noteTimes, setNoteTimes] = useState({});

    // STATE: Stores total time in seconds locally for instant updates and persistence
    const [localNoteSeconds, setLocalNoteSeconds] = useState({});

    // STATE: Tracks the currently active note for the timer
    const [activeNoteId, setActiveNoteId] = useState(null);

    // Used to track the time recorded when the timer was last started.
    // Keeps baseline so we can compute deltas if needed
    const [timeAtStart, setTimeAtStart] = useState({});

    const isDeveloper = currentUser?.email === 'your.developer.email@example.com';

    // --- 1. EFFECT: Close dropdown when clicking outside (Unchanged) ---
    useEffect(() => {
        const handleClickOutside = (event) => {
            const progressModalElement = document.querySelector('.user-info > div[style*="position: absolute"]');
            if (showProgressModal && progressModalElement && !progressModalElement.contains(event.target) && !event.target.closest('.user-info button')) {
                setShowProgressModal(false);
            }
        };

        if (showProgressModal) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showProgressModal]);

    // --- 2. EFFECT: Load all notes from Firestore (Unchanged) ---
    useEffect(() => {
        const loadNotes = async () => {
            if (!db) return;
            try {
                setLoading(true);
                const notesRef = collection(db, 'notes');
                const q = query(notesRef, orderBy('uploadDate', 'asc'));
                const querySnapshot = await getDocs(q);

                const notesData = querySnapshot.docs.map(doc => {
                    const data = doc.data();
                    const uploaderEmail = data.userEmail || data.uploaderEmail || 'Unknown Uploader';
                    return {
                        id: doc.id,
                        ...data,
                        userEmail: uploaderEmail,
                        uploadDate: data.uploadDate?.toDate ? data.uploadDate.toDate().toLocaleDateString() : 'N/A'
                    };
                });

                setNotes(notesData);
            } catch (error) {
                console.error('Error loading notes:', error);
            } finally {
                setLoading(false);
            }
        };
        loadNotes();
    }, []);

    // --- 3. EFFECT: Real-time listener for Student Progress (Loads persistent time data) ---
    useEffect(() => {
        if (!currentUser?.uid || !db) return;

        const studentProgressRef = doc(db, 'studentProgress', currentUser.uid);

        const unsubscribe = onSnapshot(studentProgressRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();

                const completedIds = data.completedNotes || [];
                const newNoteTimes = data.noteTimes || {};

                setCompletedNoteIds(completedIds);
                setNoteTimes(newNoteTimes);

                // Convert stored fractional minutes (float) back to seconds (integer)
                const initialSecondsFromFirestore = Object.keys(newNoteTimes).reduce((acc, noteId) => {
                    const minutes = newNoteTimes[noteId];

                    if (typeof minutes === 'number' && minutes > 0) {
                        acc[noteId] = Math.floor(minutes * 60);
                    } else {
                        acc[noteId] = 0;
                    }
                    return acc;
                }, {});

                // MERGE instead of overwrite - also only update when firestore seconds are greater than local
                setLocalNoteSeconds(prev => {
                    const merged = { ...prev };
                    Object.keys(initialSecondsFromFirestore).forEach(id => {
                        const fsSeconds = initialSecondsFromFirestore[id] || 0;
                        // Only accept Firestore value if it increases or local doesn't have it
                        if (!merged[id] || fsSeconds > merged[id]) {
                            merged[id] = fsSeconds;
                        }
                    });
                    return merged;
                });

                // Do NOT blindly overwrite timeAtStart to avoid resetting timers mid-session.
                // Only set baseline for notes we don't already have.
                setTimeAtStart(prev => {
                    const merged = { ...prev };
                    Object.keys(initialSecondsFromFirestore).forEach(id => {
                        if (merged[id] === undefined) {
                            merged[id] = initialSecondsFromFirestore[id];
                        }
                    });
                    return merged;
                });

            } else {
                // Document does not exist, reset states
                setCompletedNoteIds([]);
                setNoteTimes({});
                setLocalNoteSeconds({});
                setTimeAtStart({});
            }
        }, (error) => {
            console.error("Error listening to student progress:", error);
        });

        return () => unsubscribe();
    }, [currentUser]);

    // --- 4. EFFECT: Timer for Real-Time Time Tracking (Active Note) ---
    useEffect(() => {

        if (!currentUser?.uid || !activeNoteId) {
            return;
        }

        // Baseline time when session started (from local state)
        const startSecondsForSession = localNoteSeconds[activeNoteId] || 0;
        let secondsElapsedSinceLastSave = 0;

        console.debug(`[TIMER START] Note: ${activeNoteId} starting from ${startSecondsForSession}s`);

        const intervalId = setInterval(() => {
            secondsElapsedSinceLastSave += 1;

            setLocalNoteSeconds(prevSeconds => {
                const newTime = (prevSeconds[activeNoteId] || 0) + 1;

                // --- COMPLETION LOGIC ---
                if (newTime >= COMPLETION_THRESHOLD_SECONDS && !completedNoteIds.includes(activeNoteId)) {
                    // minutes to log since the last persistence point
                    const minutesToLog = Math.max(0, secondsElapsedSinceLastSave / 60);

                    if (minutesToLog >= MIN_LOG_MINUTES) {
                        logTimeOnNote(currentUser.uid, activeNoteId, minutesToLog)
                            .then(() => {
                                console.debug(`[AUTO-COMPLETE LOGGED] ${minutesToLog.toFixed(3)}m for ${activeNoteId}`);
                            })
                            .catch(error => console.error("Completion time logging failed:", error));
                    }

                    // mark complete (best-effort, relies on backend logic)
                    markNoteComplete(currentUser.uid, activeNoteId)
                        .then(() => {
                            console.debug(`[AUTO-COMPLETE] Marked ${activeNoteId} as complete`);
                        })
                        .catch(error => console.error("Auto-completion failed:", error));

                    // reset seconds counter for saving, because we've logged recently
                    secondsElapsedSinceLastSave = 0;
                }

                // PERSISTENCE: Logs 1 whole minute to Firestore every 60 seconds
                if (secondsElapsedSinceLastSave >= 60) {
                    // log exactly 1 minute (server-side uses increment)
                    logTimeOnNote(currentUser.uid, activeNoteId, 1)
                        .then(() => {
                            console.debug(`[PERSISTENCE] Logged 1 minute for ${activeNoteId}`);
                        })
                        .catch(error => {
                            console.error("Failed to log time spent to Firestore:", error);
                        });
                    secondsElapsedSinceLastSave = 0;
                }

                return {
                    ...prevSeconds,
                    [activeNoteId]: newTime
                };
            });

        }, 1000);

        // Cleanup: run when activeNoteId changes or component unmounts.
        return () => {
            clearInterval(intervalId);

            const secondsToLog = secondsElapsedSinceLastSave;
            const currentNoteId = activeNoteId;

            // Only proceed if there is unsaved time and a valid currentNoteId
            if (secondsToLog > 0 && currentNoteId) {
                const remainingUnsavedMinutes = secondsToLog / 60;

                // Only log if above minimum threshold to avoid tiny writes
                if (remainingUnsavedMinutes >= MIN_LOG_MINUTES) {
                    logTimeOnNote(currentUser.uid, currentNoteId, remainingUnsavedMinutes)
                        .then(() => {
                            console.debug(`[PERSISTENCE SUCCESS] Logged final ${remainingUnsavedMinutes.toFixed(3)} minutes upon timer stop for ID: ${currentNoteId}.`);
                            // Force local state update to avoid flicker while listener updates
                            setLocalNoteSeconds(prevSeconds => {
                                const finalSeconds = (prevSeconds[currentNoteId] || 0) + secondsToLog;
                                return {
                                    ...prevSeconds,
                                    [currentNoteId]: finalSeconds
                                };
                            });
                        })
                        .catch(error => console.error("Failed to log remaining time:", error));
                } else {
                    // If below threshold, still merge the seconds locally so UI shows progressed time
                    setLocalNoteSeconds(prevSeconds => {
                        const finalSeconds = (prevSeconds[currentNoteId] || 0) + secondsToLog;
                        return {
                            ...prevSeconds,
                            [currentNoteId]: finalSeconds
                        };
                    });
                    console.debug(`[PERSISTENCE SKIPPED] ${remainingUnsavedMinutes.toFixed(3)}m too small to persist for ${currentNoteId}`);
                }
            }

            // IMPORTANT: DO NOT clear activeNoteId here. The caller should control that.
            console.debug(`[TIMER STOP] Cleanup finished for note: ${currentNoteId}`);
        };
    }, [currentUser, activeNoteId, completedNoteIds]); // localNoteSeconds intentionally omitted to avoid interval re-creation

    // --- PROGRESS CALCULATION (Memoized Data) ---
    const progressData = useMemo(() => {
        const total = notes.length;

        // 1. Get IDs completed by time threshold locally (transient)
        const localCompletedIds = notes.filter(note => {
            const timeSpentSeconds = Math.floor(localNoteSeconds[note.id] || 0);
            return timeSpentSeconds >= COMPLETION_THRESHOLD_SECONDS;
        }).map(note => note.id);

        // 2. Combine Firestore-synced IDs and locally completed IDs into a unique Set
        const uniqueCompletedIds = new Set([
            ...new Set(completedNoteIds || []),
            ...localCompletedIds
        ]);

        // Cap the completed count at the total number of available notes
        const rawCompletedCount = uniqueCompletedIds.size;
        const completed = Math.min(rawCompletedCount, total);

        // 3. Calculate final metrics
        const pending = total > 0 ? total - completed : 0;

        // Ensure percentage calculation is based on the capped count and also capped at 100
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

        // 4. Prepare the list of notes for the modal
        const trackedNotesList = notes
            .map(note => ({
                ...note,
                timeSpentSeconds: Math.floor(localNoteSeconds[note.id] || 0)
            }))
            .sort((a, b) => b.timeSpentSeconds - a.timeSpentSeconds);

        // 5. Calculate total tracked time in seconds
        const totalSeconds = Object.values(localNoteSeconds).reduce((sum, seconds) => sum + seconds, 0);

        return {
            totalNotes: total,
            completedCount: completed,
            pendingCount: pending,
            progressPercentage: Math.min(100, percentage),
            trackedNotesList,
            totalTrackedSeconds: Math.floor(totalSeconds)
        };
    }, [notes, localNoteSeconds, completedNoteIds]);

    // --- ACTION: Handle viewing a note and starting the timer ---
    const handleViewNote = useCallback((note) => {
        // Stop previous timer by setting activeNoteId to null first if different note
        // This will trigger the cleanup for the previously active note which saves remaining time.
        setActiveNoteId(prevActive => {
            if (prevActive && prevActive !== note.id) {
                console.debug(`[SWITCH NOTE] Switching from ${prevActive} to ${note.id}`);
                // Setting null briefly triggers cleanup; then we set new active ID below.
                // We don't need to clear it here though; we will set the new ID in timeout.
            }
            return prevActive;
        });

        // Start timer for the new note in the next tick, ensures previous cleanup runs
        setTimeout(() => {
            setActiveNoteId(note.id);
            // Set the baseline time when the timer is started
            setTimeAtStart(prev => ({ ...prev, [note.id]: localNoteSeconds[note.id] || 0 }));
            console.debug(`[Timer Start] Setting active note ID: ${note.id} (FROM NOTE CARD CLICK)`);
        }, 50);

        try {
            const fileUrl = `http://localhost:3001/api/download/${note.localFileName}`;
            window.open(fileUrl, '_blank');
        } catch (error) {
            console.error('Error attempting to open note file:', error);
            alert('Note file may not have opened. The study timer has started.');
        }
    }, [localNoteSeconds]);

    // --- New Function: Lookup ID by Title (Used by ChatInterface) ---
    const getNoteIdByTitle = useCallback((title) => {
        const foundNote = notes.find(note => note.title === title);
        if (foundNote) {
            console.log(`[ChatInterface Lookup] Found ID: ${foundNote.id} for Title: ${title}`);
            return foundNote.id;
        }
        console.warn(`[ChatInterface Lookup] Note ID not found for Title: ${title}`);
        return null;
    }, [notes]);

    // --- Developer Function: Clear All Progress ---
    const handleClearProgress = useCallback(async () => {
        if (!currentUser?.uid) return;

        if (!window.confirm("ARE YOU SURE? This will permanently delete ALL tracked time and completion status for this user.")) {
            return;
        }

        try {
            // Stop any running timer first
            setActiveNoteId(null);

            const progressRef = doc(db, 'studentProgress', currentUser.uid);
            // Overwrite the document with empty arrays/objects
            await setDoc(progressRef, {
                completedNotes: [],
                noteTimes: {},
                lastActivity: new Date()
            }, { merge: true });

            alert('Progress cleared. Dashboard will reset shortly.');
        } catch (error) {
            console.error('Failed to clear progress:', error);
            alert('Failed to clear progress. Check console.');
        }
    }, [currentUser?.uid]);

    // --- ACTION: Manual Stop Timer Button ---
    const handleStopTimer = useCallback(() => {
        if (activeNoteId) {
            // Setting activeNoteId to null triggers the cleanup function (Effect 4's return)
            setActiveNoteId(null);
            console.log(`[STATE UPDATE] Manually stopped timer for Note ID: ${activeNoteId}`);
            alert('Timer stopped manually. Any unsaved time has been logged locally and will be persisted.');
        } else {
            alert('No active timer to stop.');
        }
    }, [activeNoteId]);

    // --- RENDER LOGIC: Main Dashboard ---
    if (loading && notes.length === 0) {
        return (
            <div className="dashboard-container">
                <div className="animated-background"><Threads color={[0.2, 0.8, 0.4]} amplitude={0.3} distance={0.2} enableMouseInteraction={true} /></div>
                <div className="container content-above-background" style={{ textAlign: 'center', paddingTop: '100px' }}>
                    <h2>Loading Student Dashboard... ⏳</h2>
                </div>
            </div>
        );
    }

    return (
        <div className="dashboard-container">
            <div className="animated-background">
                <Threads
                    color={[0.2, 0.8, 0.4]}
                    amplitude={0.3}
                    distance={0.2}
                    enableMouseInteraction={true}
                />
            </div>

            <header className="dashboard-header content-above-background">
                <div className="dashboard-header-content">
                    {/* Brand/Title */}
                    <div className="dashboard-title">
                        <div className="brand-logo-small">
                            <span className="brand-name-small">Assisted Tutor for Visually Impaired</span>
                        </div>
                        <span>|</span>
                        <span>Student Dashboard</span>
                    </div>

                    {/* User Actions & Progress */}
                    <div className="user-info" style={{ display: 'flex', gap: '12px', alignItems: 'center', position: 'relative' }}>
                        {isDeveloper && (
                            <button
                                onClick={handleClearProgress}
                                className="modern-btn modern-btn-danger"
                                style={{ backgroundColor: '#dc2626', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}
                            >
                                Clear All Progress
                            </button>
                        )}
                        {activeNoteId && (
                            <button
                                onClick={handleStopTimer}
                                className="modern-btn modern-btn-secondary"
                                style={{ backgroundColor: '#f97316', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}
                            >
                                Stop Timer
                            </button>
                        )}
                        <button
                            onClick={() => setShowProgressModal(prev => !prev)}
                            className="modern-btn modern-btn-secondary"
                        >
                            Progress ({Math.min(100, progressData.progressPercentage)}%)
                        </button>
                        <button onClick={logout} className="modern-btn modern-btn-danger">
                            Logout
                        </button>
                        {showProgressModal && (
                            <ProgressModal
                                progressData={progressData}
                                activeNoteId={activeNoteId}
                                formatTime={formatTime}
                                onClose={() => setShowProgressModal(false)}
                            />
                        )}
                    </div>
                </div>
            </header>

            <div className="container content-above-background">
                <div className="pdf-viewer-section">
                    <div className="pdf-viewer-header">
                        <h2 className="section-title">Available Course Notes </h2>
                        <div className="notes-count">
                            {loading ? 'Loading...' : `Total: ${notes.length} notes`}
                        </div>
                    </div>

                    <div className="notes-container">
                        <div className="notes-grid">
                            {notes.length === 0 && !loading ? (
                                <div className="empty-state">
                                    <p>No notes available</p>
                                </div>
                            ) : (
                                notes.map(note => {
                                    // Time spent comes from localNoteSeconds, which is hydrated by the listener (Effect 3)
                                    const timeSpentSeconds = Math.floor(localNoteSeconds[note.id] || 0);

                                    const isComplete = (completedNoteIds || []).includes(note.id) || (timeSpentSeconds >= COMPLETION_THRESHOLD_SECONDS);

                                    return (
                                        <div
                                            key={note.id}
                                            className="note-card"
                                            style={{ border: isComplete ? '3px solid #10b981' : '1px solid #e5e7eb' }}
                                        >
                                            <div
                                                onClick={() => handleViewNote(note)}
                                                style={{ cursor: 'pointer', paddingBottom: '10px' }}
                                                onMouseDown={(e) => e.preventDefault()}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(e) => { if (e.key === 'Enter') handleViewNote(note); }}
                                            >
                                                <div className="note-header">
                                                    <h4 className="note-title">{note.title}</h4>
                                                    <img
                                                        src="/right-arrow.png"
                                                        alt="View note"
                                                        className="note-arrow"
                                                        style={{ height: '24px', width: '24px' }}
                                                    />
                                                </div>
                                                <p className="note-description">{note.description}</p>
                                                <div className="note-meta">
                                                    <span className="file-info">{note.fileName}</span>
                                                    <span className="file-size">{formatFileSize(note.fileSize)}</span>
                                                    <span className="upload-date">{note.uploadDate}</span>
                                                </div>
                                                <p style={{ marginTop: '8px', fontSize: '13px', color: '#059669', fontWeight: '600' }}>
                                                </p>
                                            </div>

                                            {/* RENDER COMPLETION STATUS/PROGRESS */}
                                            {!isComplete && (
                                                <div style={{ padding: '0 15px 15px', borderTop: '1px solid #eee', marginTop: '10px', paddingTop: '10px', textAlign: 'center' }}>
                                                    <div style={{ height: '8px', background: '#f3f4f6', borderRadius: '4px', overflow: 'hidden' }}>
                                                        <div
                                                            style={{
                                                                width: `${Math.min(100, (timeSpentSeconds / COMPLETION_THRESHOLD_SECONDS) * 100).toFixed(0)}%`,
                                                                height: '100%',
                                                                background: '#3b82f6'
                                                            }}
                                                        />
                                                    </div>
                                                    <p style={{ fontSize: '12px', marginTop: '4px', color: '#6b7280' }}>
                                                        {Math.min(100, (timeSpentSeconds / COMPLETION_THRESHOLD_SECONDS) * 100).toFixed(0)}% to Completion
                                                    </p>
                                                </div>
                                            )}
                                            {isComplete && (
                                                <div style={{ padding: '0 15px 15px', borderTop: '1px solid #eee', marginTop: '10px', paddingTop: '10px', textAlign: 'center' }}>
                                                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '14px' }}>
                                                        ✅ Completed
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                {/* Ask Questions Section */}
                <div className="chat-section">
                    <ChatInterface
                        setActiveNoteId={setActiveNoteId}
                        getNoteIdByTitle={getNoteIdByTitle}
                    />
                </div>
            </div>
        </div>
    );
}

export default StudentDashboard;
