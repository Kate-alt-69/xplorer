using System.Text;

namespace Xplorer.Native.Services;

/// <summary>
/// Small VT text model for the embedded terminal. ConPTY emits UTF-8 text mixed with virtual
/// terminal sequences; this keeps the common cursor/erase operations used by PowerShell, cmd and
/// console tools without coupling file browsing to a browser/WebView terminal dependency.
/// </summary>
internal sealed class TerminalTextBuffer
{
    private const int MaxScrollbackLines = 4000;

    private readonly object _gate = new();
    private readonly List<StringBuilder> _lines = [new StringBuilder()];
    private readonly StringBuilder _sequence = new();
    private ParserState _state;
    private int _row;
    private int _column;
    private int _savedRow;
    private int _savedColumn;

    public void Append(string text)
    {
        if (string.IsNullOrEmpty(text)) return;

        lock (_gate)
        {
            foreach (var character in text)
                Process(character);
            TrimScrollback();
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _lines.Clear();
            _lines.Add(new StringBuilder());
            _row = 0;
            _column = 0;
            _savedRow = 0;
            _savedColumn = 0;
            _state = ParserState.Normal;
            _sequence.Clear();
        }
    }

    public string Snapshot()
    {
        lock (_gate)
        {
            var capacity = _lines.Sum(line => line.Length + 2);
            var output = new StringBuilder(capacity);
            for (var index = 0; index < _lines.Count; index++)
            {
                if (index > 0) output.Append("\r\n");
                output.Append(_lines[index]);
            }
            return output.ToString();
        }
    }

    private void Process(char character)
    {
        switch (_state)
        {
            case ParserState.Escape:
                ProcessEscape(character);
                return;
            case ParserState.Csi:
                ProcessCsi(character);
                return;
            case ParserState.Osc:
                if (character == '\a')
                    _state = ParserState.Normal;
                else if (character == '\x1b')
                    _state = ParserState.OscEscape;
                return;
            case ParserState.OscEscape:
                _state = character == '\\' ? ParserState.Normal : ParserState.Osc;
                return;
        }

        switch (character)
        {
            case '\x1b':
                _state = ParserState.Escape;
                break;
            case '\r':
                _column = 0;
                break;
            case '\n':
                LineFeed();
                break;
            case '\b':
                _column = Math.Max(0, _column - 1);
                break;
            case '\t':
                _column = ((_column / 8) + 1) * 8;
                EnsureColumn(CurrentLine(), _column);
                break;
            default:
                if (!char.IsControl(character)) WriteCharacter(character);
                break;
        }
    }

    private void ProcessEscape(char character)
    {
        _state = ParserState.Normal;
        switch (character)
        {
            case '[':
                _sequence.Clear();
                _state = ParserState.Csi;
                break;
            case ']':
                _state = ParserState.Osc;
                break;
            case '7':
                SaveCursor();
                break;
            case '8':
                RestoreCursor();
                break;
            case 'c':
                ResetScreen();
                break;
        }
    }

    private void ProcessCsi(char character)
    {
        if (character is >= '@' and <= '~')
        {
            var parameters = _sequence.ToString();
            _sequence.Clear();
            _state = ParserState.Normal;
            HandleCsi(character, parameters);
            return;
        }

        if (_sequence.Length < 128)
            _sequence.Append(character);
    }

    private void HandleCsi(char command, string rawParameters)
    {
        var privateMode = rawParameters.StartsWith('?') || rawParameters.StartsWith('>');
        if (privateMode) rawParameters = rawParameters[1..];
        var values = ParseParameters(rawParameters);
        var first = values.Count == 0 ? 0 : values[0];
        var count = first <= 0 ? 1 : first;

        switch (command)
        {
            case 'A':
                _row = Math.Max(0, _row - count);
                EnsureRow(_row);
                break;
            case 'B':
                _row += count;
                EnsureRow(_row);
                break;
            case 'C':
                _column += count;
                EnsureColumn(CurrentLine(), _column);
                break;
            case 'D':
                _column = Math.Max(0, _column - count);
                break;
            case 'E':
                _row += count;
                _column = 0;
                EnsureRow(_row);
                break;
            case 'F':
                _row = Math.Max(0, _row - count);
                _column = 0;
                EnsureRow(_row);
                break;
            case 'G':
                _column = Math.Max(0, count - 1);
                EnsureColumn(CurrentLine(), _column);
                break;
            case 'H':
            case 'f':
            {
                var targetRow = values.Count > 0 && values[0] > 0 ? values[0] - 1 : 0;
                var targetColumn = values.Count > 1 && values[1] > 0 ? values[1] - 1 : 0;
                _row = Math.Max(0, targetRow);
                _column = Math.Max(0, targetColumn);
                EnsureRow(_row);
                EnsureColumn(CurrentLine(), _column);
                break;
            }
            case 'd':
                _row = Math.Max(0, count - 1);
                EnsureRow(_row);
                break;
            case 'J':
                EraseDisplay(first);
                break;
            case 'K':
                EraseLine(first);
                break;
            case 'P':
                DeleteCharacters(count);
                break;
            case '@':
                InsertCharacters(count);
                break;
            case 'X':
                EraseCharacters(count);
                break;
            case 's':
                SaveCursor();
                break;
            case 'u':
                RestoreCursor();
                break;
            case 'm':
                // Styling is intentionally ignored by this lightweight text renderer. ConPTY still
                // receives and executes the full terminal stream; only presentation is flattened.
                break;
            default:
                // Private modes, scroll regions and device-status queries are presentation/control
                // details that do not alter the text model used by Xplorer.
                break;
        }
    }

    private void LineFeed()
    {
        _row++;
        EnsureRow(_row);
        _column = 0;
    }

    private void WriteCharacter(char character)
    {
        var line = CurrentLine();
        EnsureColumn(line, _column);
        if (_column < line.Length)
            line[_column] = character;
        else
            line.Append(character);
        _column++;
    }

    private void EraseDisplay(int mode)
    {
        switch (mode)
        {
            case 2:
            case 3:
                ResetScreen();
                break;
            case 1:
                for (var index = 0; index < _row; index++) _lines[index].Clear();
                EraseLine(1);
                break;
            default:
                EraseLine(0);
                if (_row + 1 < _lines.Count)
                    _lines.RemoveRange(_row + 1, _lines.Count - (_row + 1));
                break;
        }
    }

    private void EraseLine(int mode)
    {
        var line = CurrentLine();
        switch (mode)
        {
            case 1:
            {
                EnsureColumn(line, _column + 1);
                var limit = Math.Min(_column, line.Length - 1);
                for (var index = 0; index <= limit; index++) line[index] = ' ';
                break;
            }
            case 2:
                line.Clear();
                break;
            default:
                if (_column < line.Length) line.Length = _column;
                break;
        }
    }

    private void DeleteCharacters(int count)
    {
        var line = CurrentLine();
        if (_column >= line.Length) return;
        line.Remove(_column, Math.Min(count, line.Length - _column));
    }

    private void InsertCharacters(int count)
    {
        var line = CurrentLine();
        EnsureColumn(line, _column);
        line.Insert(_column, new string(' ', count));
    }

    private void EraseCharacters(int count)
    {
        var line = CurrentLine();
        EnsureColumn(line, _column + count);
        var end = Math.Min(line.Length, _column + count);
        for (var index = _column; index < end; index++) line[index] = ' ';
    }

    private void SaveCursor()
    {
        _savedRow = _row;
        _savedColumn = _column;
    }

    private void RestoreCursor()
    {
        _row = Math.Max(0, _savedRow);
        _column = Math.Max(0, _savedColumn);
        EnsureRow(_row);
        EnsureColumn(CurrentLine(), _column);
    }

    private void ResetScreen()
    {
        _lines.Clear();
        _lines.Add(new StringBuilder());
        _row = 0;
        _column = 0;
    }

    private StringBuilder CurrentLine()
    {
        EnsureRow(_row);
        return _lines[_row];
    }

    private void EnsureRow(int row)
    {
        while (_lines.Count <= row) _lines.Add(new StringBuilder());
    }

    private static void EnsureColumn(StringBuilder line, int column)
    {
        while (line.Length < column) line.Append(' ');
    }

    private void TrimScrollback()
    {
        if (_lines.Count <= MaxScrollbackLines) return;
        var remove = _lines.Count - MaxScrollbackLines;
        _lines.RemoveRange(0, remove);
        _row = Math.Max(0, _row - remove);
        _savedRow = Math.Max(0, _savedRow - remove);
    }

    private static List<int> ParseParameters(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return [];
        var result = new List<int>();
        foreach (var part in raw.Split(';'))
            result.Add(int.TryParse(part, out var value) ? value : 0);
        return result;
    }

    private enum ParserState
    {
        Normal,
        Escape,
        Csi,
        Osc,
        OscEscape,
    }
}
