import { CommandSuggestion, FileMentionSuggestion } from '@/components/AgentInputSuggestionView';
import * as React from 'react';
import { searchFiles, FileItem } from '@/sync/suggestionFile';
import { searchCommands, CommandItem } from '@/sync/suggestionCommands';

export async function getCommandSuggestions(sessionId: string, query: string, kind?: 'command' | 'skill'): Promise<{
    key: string;
    text: string;
    component: React.ComponentType;
}[]> {
    // Remove the "/" prefix for searching
    const searchTerm = query.slice(1);
    
    try {
        // Use the command search cache with fuzzy matching
        const commands = await searchCommands(sessionId, searchTerm, { limit: 5, kind });
        
        // Convert CommandItem to suggestion format
        return commands.map((cmd: CommandItem) => ({
            key: `${cmd.kind ?? 'command'}-${cmd.command}`,
            text: cmd.kind === 'skill' ? `$${cmd.command}` : `/${cmd.command}`,
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

export async function getFileMentionSuggestions(sessionId: string, query: string): Promise<{
    key: string;
    text: string;
    component: React.ComponentType;
}[]> {
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

export async function getSuggestions(sessionId: string, query: string): Promise<{
    key: string;
    text: string;
    component: React.ComponentType;
}[]> {
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
    
    // Check if it's a file mention (starts with @)
    if (query.startsWith('@')) {
        console.log('💡 getSuggestions: File mention detected');
        const result = await getFileMentionSuggestions(sessionId, query);
        console.log('💡 getSuggestions: File suggestions:', JSON.stringify(result.map(r => ({
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
