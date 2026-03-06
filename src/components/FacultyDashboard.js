import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Threads from './background'; // Assuming this is your background component
import { 
    collection, 
    addDoc, 
    getDocs, 
    deleteDoc, 
    doc, 
    query, 
    where, 
} from 'firebase/firestore';
import { firestore as db } from '../firebase';

// Helper component for the Progress Bar (using old format inline styles)
const ProgressBar = ({ percent }) => {
    const color = percent < 30 ? '#ef4444' : percent < 70 ? '#f59e0b' : '#10b981';
    return (
        <div style={{ height: '8px', backgroundColor: '#e5e7eb', borderRadius: '4px', overflow: 'hidden', width: '100%', minWidth: '100px' }}>
            <div 
                style={{ 
                    height: '100%', 
                    width: `${percent}%`, 
                    backgroundColor: color, 
                    transition: 'width 0.5s ease-out' 
                }}
            />
        </div>
    );
};

// Helper component for the Weekly Activity Chart (Simplified old format)
const ActivityChart = ({ series }) => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const maxMinutes = Math.max(...series, 1); // Avoid division by zero

    return (
        <div style={{ display: 'flex', gap: '4px', height: '50px', alignItems: 'flex-end', paddingTop: '8px' }}>
            {series.map((minutes, index) => (
                <div 
                    key={index} 
                    title={`${minutes} minutes on ${days[index]}`}
                    style={{ 
                        width: `${100 / 7}%`, 
                        height: `${(minutes / maxMinutes) * 100}%`, 
                        backgroundColor: minutes > 0 ? '#3b82f6' : '#9ca3af',
                        borderRadius: '2px',
                        transition: 'height 0.3s ease-out'
                    }}
                />
            ))}
        </div>
    );
};


function FacultyDashboard() {
    const { currentUser, logout } = useAuth();
    const [notes, setNotes] = useState([]);
    const [students, setStudents] = useState([]);
    // State to hold the aggregated progress data { studentId: { readCount, totalNotes, percent, weeklySeries, totalMinutes } }
    const [studentProgress, setStudentProgress] = useState({}); 
    const [studentsLoading, setStudentsLoading] = useState(false);
    const [progressLoading, setProgressLoading] = useState(false); 
    const [showUploadForm, setShowUploadForm] = useState(false);
    const [selectedNote, setSelectedNote] = useState(null);
    const [newNote, setNewNote] = useState({
        title: '',
        description: '',
        file: null
    });
    const [activeTab, setActiveTab] = useState('home');
    const tabsRef = useRef(null);
    const homeTabRef = useRef(null);
    const progressTabRef = useRef(null);
    const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

    // New/Modified logic for the tab indicator (KEPT AS IS)
    useEffect(() => {
        const updateIndicator = () => {
            const container = tabsRef.current;
            const target = activeTab === 'home' ? homeTabRef.current : progressTabRef.current;
            if (container && target) {
                const containerRect = container.getBoundingClientRect();
                const targetRect = target.getBoundingClientRect();
                const left = targetRect.left - containerRect.left;
                const width = targetRect.width;
                setIndicatorStyle({ left, width });
            }
        };

        updateIndicator();
        window.addEventListener('resize', updateIndicator);
        return () => window.removeEventListener('resize', updateIndicator);
    }, [activeTab]);

    // Load notes from Firestore on component mount
    useEffect(() => {
        const loadNotes = async () => {
            if (currentUser) {
                try {
                    const notesRef = collection(db, 'notes');
                    const q = query(
                        notesRef, 
                        where('userId', '==', currentUser.uid)
                    );
                    const querySnapshot = await getDocs(q);
                    
                    const notesData = querySnapshot.docs.map(doc => {
                        const data = doc.data();
                        return {
                            id: doc.id,
                            ...data,
                            // Ensure consistent date parsing for sorting
                            uploadDate: data.uploadDate?.toDate ? data.uploadDate.toDate() : new Date(data.uploadDate),
                            uploadDateString: data.uploadDate?.toDate ? data.uploadDate.toDate().toLocaleDateString() : (data.uploadDate || '')
                        };
                    });
                    
                    // Sort by uploadDate object
                    notesData.sort((a, b) => b.uploadDate - a.uploadDate); // Sort newest first
                    
                    setNotes(notesData.map(note => ({
                        ...note,
                        uploadDate: note.uploadDateString // Use the formatted string for display
                    })));
                } catch (error) {
                    console.error('Error loading notes:', error);
                }
            }
        };
        loadNotes();
    }, [currentUser]);

    // --- UPDATED FEATURE: Load Students and their REAL Progress for Progress tab ---
    useEffect(() => {
        const loadStudents = async () => {
            try {
                setStudentsLoading(true);
                const usersRef = collection(db, 'users');
                const studentsQuery = query(usersRef, where('role', '==', 'Student'));
                const snapshot = await getDocs(studentsQuery);
                const studentsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                studentsData.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
                setStudents(studentsData);
                return studentsData;
            } catch (error) {
                console.error('Error loading students:', error);
                return []; 
            } finally {
                setStudentsLoading(false);
            }
        };

        const loadRealProgress = async (studentList, notesList) => {
            if (!studentList || studentList.length === 0 || !notesList || notesList.length === 0) {
                setProgressLoading(false);
                return;
            }
            setProgressLoading(true);
            const progressMap = {};
            // Filter notes to only those uploaded by this faculty (currentUser.uid)
            const facultyNotes = notesList.filter(note => note.userId === currentUser.uid); 
            const totalNotes = facultyNotes.length; 

            try {
                // 1. Fetch Real Notes Read Status (Digital Twin: Read Status)
                const readNotesRef = collection(db, 'studentReadNotes');
                // Query only for notes belonging to the current faculty's uploaded notes
                const facultyNoteIds = facultyNotes.map(n => n.id);
                // NOTE: Firestore `in` clause limits array size (typically 10). A more robust app 
                // would loop through student IDs or use a different database structure/query.
                const readNotesQuery = facultyNoteIds.length > 0
                    ? query(readNotesRef, where('noteId', 'in', facultyNoteIds))
                    : query(readNotesRef); 

                const readNotesSnapshot = await getDocs(readNotesQuery);
                const readNotesData = {}; 
                readNotesSnapshot.forEach(doc => {
                    const data = doc.data();
                    const studentId = data.studentId;
                    const noteId = data.noteId;
                    // Only count if the note is one of THIS faculty's notes
                    if (facultyNoteIds.includes(noteId)) {
                        if (!readNotesData[studentId]) {
                            readNotesData[studentId] = new Set();
                        }
                        readNotesData[studentId].add(noteId);
                    }
                });

                // 2. Fetch Real Weekly Activity (Digital Twin: Activity/Engagement)
                const activityRef = collection(db, 'studentActivity');
                const activitySnapshot = await getDocs(activityRef); 
                const weeklyActivityData = {}; 
                const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                
                activitySnapshot.forEach(doc => {
                    const data = doc.data();
                    const studentId = data.studentId;
                    const dayOfWeek = data.dayOfWeek; 
                    const minutes = data.minutes || 0; 
                    
                    if (!weeklyActivityData[studentId]) {
                        weeklyActivityData[studentId] = { 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0, 'Sun': 0 };
                    }
                    if (daysOfWeek.includes(dayOfWeek)) {
                        weeklyActivityData[studentId][dayOfWeek] += minutes;
                    }
                });

                // 3. Aggregate into the progressMap
                studentList.forEach(s => {
                    const readCount = readNotesData[s.id] ? readNotesData[s.id].size : 0;
                    const clampedRead = Math.min(readCount, totalNotes);
                    const percent = totalNotes > 0 ? Math.round((clampedRead / totalNotes) * 100) : 0;
                    
                    const weeklyActivity = weeklyActivityData[s.id] || { 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0, 'Sun': 0 };
                    const weeklySeries = daysOfWeek.map(day => weeklyActivity[day] || 0);
                    const totalMinutes = weeklySeries.reduce((a, b) => a + b, 0);

                    progressMap[s.id] = {
                        readCount: clampedRead,
                        totalNotes: totalNotes,
                        percent: percent,
                        weeklySeries: weeklySeries,
                        totalMinutes: totalMinutes,
                    };
                });

                setStudentProgress(progressMap);
            } catch (error) {
                console.error('Error loading student progress:', error);
            } finally {
                setProgressLoading(false);
            }
        };

        if (activeTab === 'progress' && currentUser) {
            // Only proceed if notes have been loaded and are available
            loadStudents().then((loadedStudents) => {
                if (loadedStudents && notes.length > 0) {
                    loadRealProgress(loadedStudents, notes); 
                }
            });
        }
    }, [activeTab, notes, currentUser]); // Depend on 'notes' and 'currentUser'

    const handleFileChange = (e) => {
        setNewNote({ ...newNote, file: e.target.files[0] });
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const clearFile = () => {
        setNewNote({ ...newNote, file: null });
        document.getElementById('file-upload').value = null;
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setNewNote(prev => ({ ...prev, [name]: value }));
    };

    // FIX APPLIED: Added currentUser.email to the note document
    const handleUpload = async (e) => {
        e.preventDefault();
        if (!newNote.file || !currentUser) return;
        
        console.log("Simulating file upload and Firestore write...");

        try {
            const newDocRef = await addDoc(collection(db, 'notes'), {
                userId: currentUser.uid,
                userEmail: currentUser.email, // Include the faculty's email for the student dashboard display
                title: newNote.title,
                description: newNote.description,
                fileName: newNote.file.name,
                fileSize: newNote.file.size,
                localFileName: newNote.file.name, // Placeholder for the actual file path/URL
                uploadDate: new Date(),
            });

            // Manually update notes state to include the new note and re-sort (for faster UI update)
            const newlyAddedNote = {
                id: newDocRef.id,
                userId: currentUser.uid,
                userEmail: currentUser.email,
                title: newNote.title,
                description: newNote.description,
                fileName: newNote.file.name,
                fileSize: newNote.file.size,
                localFileName: newNote.file.name,
                uploadDate: new Date().toLocaleDateString(),
            };

            setNotes(prevNotes => [newlyAddedNote, ...prevNotes]);
            
            setNewNote({ title: '', description: '', file: null });
            setShowUploadForm(false);
            alert('Note uploaded successfully!');

        } catch (error) {
            console.error('Error adding document:', error);
            alert('Failed to upload note.');
        }
    };

    // COMPLETED FEATURE: Implementation of the handleDeleteNote function.
    const handleDeleteNote = async (noteId) => {
        if (!window.confirm("Are you sure you want to delete this note? This action cannot be undone.")) {
            return;
        }

        try {
            const noteToDelete = notes.find(n => n.id === noteId);
            
            // 1. Delete the Firestore Document
            const noteRef = doc(db, 'notes', noteId);
            await deleteDoc(noteRef);
            
            console.log(`Note ${noteId} successfully deleted from Firestore.`);

            // 2. OPTIONAL: Delete the associated file from Firebase Storage (logic placeholder)
            if (noteToDelete && noteToDelete.localFileName) {
                   // Placeholder: Add Firebase Storage deletion logic here
            }

            // 3. Update the UI state
            setNotes(prevNotes => prevNotes.filter(note => note.id !== noteId));
            
            // Unselect the deleted note if it was currently selected
            setSelectedNote(prevSelectedNote => 
                prevSelectedNote && prevSelectedNote.id === noteId ? null : prevSelectedNote
            );

            alert('Note deleted successfully.');

        } catch (error) {
            console.error('Error deleting note:', error);
            alert('Failed to delete the note. Check the console for permissions or other errors.');
        }
    };

    const handleSelectNote = (note) => {
        setSelectedNote(note);
    };

    const getProgressStatus = (percent) => {
        if (percent === 0) return { text: 'Not Started', color: '#dc2626' };
        if (percent < 50) return { text: 'In Progress', color: '#f59e0b' };
        if (percent < 100) return { text: 'Near Completion', color: '#10b981' };
        return { text: 'Complete', color: '#10b981' };
    };

    // --- Main Component Render ---
    return (
        <div className="dashboard-container">
          
            <header className="dashboard-header content-above-background">
                <div className="dashboard-header-content">
                    <div className="dashboard-title">
                        <div className="brand-logo-small">
                            <span className="brand-name-small">Assisted Tutor for Visually Impaired</span>
                        </div>
                        <span>|</span>
                        <span>Faculty Dashboard</span>
                    </div>
                    <div className="user-info" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <div
                            ref={tabsRef}
                            style={{ position: 'relative', display: 'flex', gap: '16px', alignItems: 'center', marginRight: '36px', paddingBottom: '6px' }}
                        >
                            <button
                                ref={homeTabRef}
                                onClick={() => setActiveTab('home')}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#111827',
                                    fontSize: 'inherit',
                                    textAlign: 'center',
                                    padding: '0',
                                    margin: 0,
                                    fontWeight: activeTab === 'home' ? 600 : 500,
                                    cursor: 'pointer'
                                }}
                            >
                                Homepage
                            </button>
                            <button
                                ref={progressTabRef}
                                onClick={() => setActiveTab('progress')}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#111827',
                                    fontSize: 'inherit',
                                    textAlign: 'center',
                                    padding: '0',
                                    margin: 0,
                                    fontWeight: activeTab === 'progress' ? 600 : 500,
                                    cursor: 'pointer'
                                }}
                            >
                                Student Data
                            </button>
                            <div
                                style={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: `${indicatorStyle.left}px`,
                                    width: `${indicatorStyle.width}px`,
                                    height: '2px',
                                    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                                    transition: 'left 220ms ease, width 220ms ease'
                                }}
                            />
                        </div>
                        <button onClick={logout} className="modern-btn modern-btn-danger">
                            Logout
                        </button>
                    </div>
                </div>
            </header>

            <div className="container content-above-background">
                {/* --- Home Tab: Note Management --- */}
                {activeTab === 'home' && (
                    <div className="pdf-viewer-section">
                        <div className="pdf-viewer-header">
                            <h2 className="section-title">Course Notes Management</h2>
                            <button 
                                className="modern-btn modern-btn-primary"
                                onClick={() => setShowUploadForm(!showUploadForm)}
                            >
                                {showUploadForm ? 'Cancel Upload' : '+ Upload New Note'}
                            </button>
                        </div>

                        {showUploadForm && (
                            <div className="modal-overlay" onClick={() => setShowUploadForm(false)}>
                                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                                    <div className="modal-header">
                                        <h3 className="modal-title">Upload New Note</h3>
                                        <button 
                                            className="modal-close"
                                            onClick={() => setShowUploadForm(false)}
                                        >
                                            ×
                                        </button>
                                    </div>
                                    
                                    <form onSubmit={handleUpload} className="upload-form">
                                        {/* Input fields... (omitted for brevity) */}
                                        <div className="form-group">
                                            <label className="form-label">Note Title</label>
                                            <input
                                                type="text"
                                                name="title"
                                                value={newNote.title}
                                                onChange={handleInputChange}
                                                className="modern-input"
                                                placeholder="Enter note title"
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Description</label>
                                            <textarea
                                                name="description"
                                                value={newNote.description}
                                                onChange={handleInputChange}
                                                className="modern-textarea"
                                                placeholder="Enter note description"
                                                rows="3"
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Upload File</label>
                                            <div className="file-input-wrapper">
                                                <input
                                                    type="file"
                                                    onChange={handleFileChange}
                                                    className="file-input"
                                                    accept=".pdf,.doc,.docx,.txt,.ppt,.pptx"
                                                    required
                                                    id="file-upload"
                                                />
                                                <label htmlFor="file-upload" className="file-input-label">
                                                    {newNote.file ? (
                                                        <div style={{ textAlign: 'center', position: 'relative' }}>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    clearFile();
                                                                }}
                                                                style={{
                                                                    position: 'absolute',
                                                                    top: '8px',
                                                                    right: '8px',
                                                                    background: '#ef4444',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '50%',
                                                                    width: '24px',
                                                                    height: '24px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '14px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    zIndex: 10
                                                                }}
                                                                title="Remove file"
                                                            >
                                                                ×
                                                            </button>
                                                            <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px', color: '#374151', wordBreak: 'break-word', padding: '0 20px' }}>
                                                                {newNote.file.name}
                                                            </div>
                                                            <div style={{ fontSize: '12px', color: '#6b7280' }}>
                                                                {formatFileSize(newNote.file.size)}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {/* Image placeholder - Assuming /add.png exists */}
                                                            <img src="/add.png" alt="Upload" style={{ width: '32px', height: '32px', marginBottom: '8px', filter: 'brightness(0) saturate(100%) invert(42%) sepia(8%) saturate(750%) hue-rotate(202deg) brightness(95%) contrast(89%)' }} />
                                                            <div>Click to upload</div>
                                                        </>
                                                    )}
                                                </label>
                                            </div>
                                        </div>

                                        <div className="form-actions">
                                            <button type="submit" className="modern-btn modern-btn-primary" disabled={!newNote.file}>
                                                Upload Note
                                            </button>
                                            <button 
                                                type="button" 
                                                className="modern-btn modern-btn-secondary"
                                                onClick={() => setShowUploadForm(false)}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        )}

                        <div className="pdf-viewer-layout">
                            {/* PDF Viewer Pane */}
                            <div className="pdf-viewer-container">
                                {selectedNote ? (
                                    <div className="pdf-viewer">
                                        <div className="pdf-content">
                                            <iframe
                                                src={`http://localhost:3001/api/download/${selectedNote.localFileName}`}
                                                className="pdf-iframe"
                                                title={selectedNote.title}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="pdf-placeholder">
                                        <div className="placeholder-content">
                                            {/* Image placeholder - Assuming /document.png exists */}
                                            <img 
                                                src="/document.png" 
                                                alt="Document" 
                                                className="placeholder-icon"
                                                style={{ width: '64px', height: '64px', opacity: 0.3 }}
                                            />
                                            <h3>Select a note to view</h3>
                                            <p>Choose a note from the sidebar to display its content here</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Notes Sidebar */}
                            <div className="notes-sidebar">
                                <h3 className="sidebar-title">Notes ({notes.length})</h3>
                                {notes.length === 0 ? (
                                    <div className="empty-state">
                                        <p>No notes :(</p>
                                    </div>
                                ) : (
                                    <div className="notes-list">
                                        {notes.map(note => (
                                            <div 
                                                key={note.id} 
                                                className={`note-card ${selectedNote?.id === note.id ? 'selected' : ''}`}
                                                onClick={() => handleSelectNote(note)}
                                            >
                                                <div className="note-header">
                                                    <h4 className="note-title">{note.title}</h4>
                                                    <button 
                                                        className="delete-btn"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteNote(note.id);
                                                        }}
                                                        title="Delete note"
                                                        style={{
                                                            background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', 
                                                            borderRadius: '4px', padding: '4px 8px', fontSize: '12px', cursor: 'pointer',
                                                            marginLeft: 'auto'
                                                        }}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                                <div className="note-meta">
                                                    <span>{note.uploadDate}</span>
                                                    <span>{formatFileSize(note.fileSize)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                
                {/* --- Completed Feature: Progress Tab Rendering --- */}
                {activeTab === 'progress' && (
                    <div className="progress-section" style={{ padding: '20px', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)' }}>
                        <h2 className="section-title" style={{ marginBottom: '20px' }}>Student Enrolled </h2>
                        
                        {(studentsLoading || progressLoading) && (
                            <div style={{ textAlign: 'center', padding: '40px' }}>
                                <p style={{ fontSize: '18px', color: '#3b82f6' }}>Loading Student Data...</p>
                                <div className="loading-spinner"></div> {/* Assuming a CSS spinner class exists */}
                            </div>
                        )}

                        {!studentsLoading && !progressLoading && students.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                                <p>No students found with the 'Student' role.</p>
                            </div>
                        )}

                        {!studentsLoading && !progressLoading && students.length > 0 && notes.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '40px', color: '#ef4444' }}>
                                <p>No notes have been uploaded by you. Student progress cannot be tracked.</p>
                            </div>
                        )}
                        
                        {!studentsLoading && !progressLoading && students.length > 0 && notes.length > 0 && (
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                                        <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600' }}>Student Email</th>
                                    
                                    </tr>
                                </thead>
                                <tbody>
                                    {students.map(student => {
                                        const progress = studentProgress[student.id] || { readCount: 0, totalNotes: notes.filter(n => n.userId === currentUser.uid).length, percent: 0, weeklySeries: [0,0,0,0,0,0,0], totalMinutes: 0 };
                                        const status = getProgressStatus(progress.percent);
                                        return (
                                            <tr key={student.id} style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }} className="table-row-hover">
                                                <td style={{ padding: '12px 16px', color: '#1f2937', fontWeight: '500' }}>
                                                    {student.email || 'N/A'}
                                                </td>
                                                
                                                
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default FacultyDashboard;