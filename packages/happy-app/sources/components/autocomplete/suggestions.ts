import { CommandSuggestion, FileMentionSuggestion, FriendMentionSuggestion } from '@/components/AgentInputSuggestionView';
import * as React from 'react';
import { searchFiles, FileItem } from '@/sync/suggestionFile';
import { searchCommands, CommandItem } from '@/sync/suggestionCommands';
import { getDisplayName, type UserProfile } from '@/sync/friendTypes';

export interface AgentInputSuggestion {
    key: string;
    text: string;
    component: React.ComponentType;
}

interface GetSuggestionsOptions {
    friends?: UserProfile[];
    includeFriends?: boolean;
}

export async function getCommandSuggestions(sessionId: string, query: string, kind?: 'command' | 'skill'): Promise<AgentInputSuggestion[]> {
    // Remove the "/" prefix for searching
    const searchTerm = query.slice(1);
    
    try {
        // Use the command search cache with fuzzy matching
        const commands = await searchCommands(sessionId, searchTerm, { limit: 5, kind });
        
        // Convert CommandItem to suggestion format
        return commands.map((cmd: CommandItem) => ({
            key: `${cmd.kind ?? 'command'}-${cmd.command}`,
            text: cmd.insertText ?? (cmd.kind === 'skill' ? `$${cmd.command}` : `/${cmd.command}`),
            component: () => React.createElement(CommandSuggestion, {
                command: cmd.command,
                description: cmd.description,
                prefix: cmd.kind === 'skill' ? '$' : '/'
            })
        }));
    } catch (error) {
        console.error('Error fetching command suggestions:', error);
        // Return empty array on error
        return [];
    }
}

export async function getFileMentionSuggestions(sessionId: string, query: string): Promise<AgentInputSuggestion[]> {
    // Remove the "@" prefix for searching
    const searchTerm = query.slice(1);
    
    try {
        // Use the file search cache with fuzzy matching
        const files = await searchFiles(sessionId, searchTerm, { limit: 5 });
        
        // Convert FileItem to suggestion format
        return files.map((file: FileItem) => ({
            key: `file-${file.fullPath}`,
            text: `@${file.fullPath}`,  // Full path in the mention
            component: () => React.createElement(FileMentionSuggestion, {
                fileName: file.fileName,
                filePath: file.filePath,
                fileType: file.fileType
            })
        }));
    } catch (error) {
        console.error('Error fetching file suggestions:', error);
        // Return empty array on error
        return [];
    }
}

export function getFriendMentionSuggestions(query: string, friends: UserProfile[]): AgentInputSuggestion[] {
    const searchTerm = query.slice(1).trim().toLowerCase();

    return friends
        .filter((friend) => {
            if (!searchTerm) {
                return true;
            }
            const displayName = getDisplayName(friend).toLowerCase();
            return friend.username.toLowerCase().includes(searchTerm) || displayName.includes(searchTerm);
        })
        .slice(0, 5)
        .map(friend => ({
            key: `friend-${friend.id}`,
            text: `@${friend.username}`,
            component: () => React.createElement(FriendMentionSuggestion, {
                username: friend.username,
                displayName: getDisplayName(friend),
            })
        }));
}

export async function getSuggestions(sessionId: string, query: string, options: GetSuggestionsOptions = {}): Promise<AgentInputSuggestion[]> {
    console.log('💡 getSuggestions called with query:', JSON.stringify(query));
    
    if (!query || query.length === 0) {
        console.log('💡 getSuggestions: Empty query, returning empty array');
        return [];
    }
    
    // Check if it's a command or skill discovery query (starts with /)
    if (query.startsWith('/')) {
        console.log('💡 getSuggestions: Command detected');
        const result = await getCommandSuggestions(sessionId, query);
        console.log('💡 getSuggestions: Command suggestions:', JSON.stringify(result.map(r => ({
            key: r.key,
            text: r.text,
            component: '[Function]'
        })), null, 2));
        return result;
    }

    // Check if it's an explicit skill query (starts with $)
    if (query.startsWith('$')) {
        console.log('💡 getSuggestions: Skill detected');
        return getCommandSuggestions(sessionId, query, 'skill');
    }
    
    // Check if it's a friend/file mention (starts with @)
    if (query.startsWith('@')) {
        console.log('💡 getSuggestions: Friend/file mention detected');
        const friendSuggestions = options.includeFriends === false
            ? []
            : getFriendMentionSuggestions(query, options.friends ?? []);
        const fileSuggestions = await getFileMentionSuggestions(sessionId, query);
        const result = [...friendSuggestions, ...fileSuggestions];
        console.log('💡 getSuggestions: Mention suggestions:', JSON.stringify(result.map(r => ({
            key: r.key,
            text: r.text,
            component: '[Function]'
        })), null, 2));
        return result;
    }
    
    // No suggestions for other queries
    console.log('💡 getSuggestions: No matching prefix, returning empty array');
    return [];
}
