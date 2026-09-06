namespace Xplorer.Native.Services;

/// <summary>
/// Styled VT model for the embedded ConPTY terminal. Cursor/erase semantics and SGR state stay
/// together so PowerShell prompts, predictions and console tools retain terminal formatting without
/// a WebView/browser terminal dependency.
/// </summary>
internal sealed class TerminalTextBuffer
{
    private const int MaxScrollbackLines = 4000;

    private readonly object _gate = new();
    private readonly List<List<TerminalCell>> _lines = [new List<TerminalCell>()];
    private readonly System.Text.StringBuilder _sequence = new();
    private ParserState _state;
    private TerminalStyle _style = TerminalStyle.Default;
    private int _row;
    private int _column;
    private int _savedRow;
    private int _savedColumn;

    public void Append(string text)
    {
        if (string.IsNullOrEmpty(text)) return;
        lock (_gate)
        {
            foreach (var character in text) Process(character);
            TrimScrollback();
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _lines.Clear();
            _lines.Add([]);
            _row = 0;
            _column = 0;
            _savedRow = 0;
            _savedColumn = 0;
            _style = TerminalStyle.Default;
            _state = ParserState.Normal;
            _sequence.Clear();
        }
    }

    public TerminalSnapshot Snapshot()
    {
        lock (_gate)
        {
            var text = new System.Text.StringBuilder(_lines.Sum(line => line.Count + 1));
            var runs = new List<TerminalStyleRun>();
            TerminalStyle? activeStyle = null;
            var runStart = 0;

            void FlushRun()
            {
                if (activeStyle is null || text.Length <= runStart) return;
                runs.Add(new TerminalStyleRun(runStart, text.Length - runStart, activeStyle.Value));
            }

            for (var lineIndex = 0; lineIndex < _lines.Count; lineIndex++)
            {
                if (lineIndex > 0)
                {
                    // RichEdit's text object model represents a paragraph break as one CR. Keeping
                    // that exact representation makes style-run offsets match GetRange positions.
                    FlushRun();
                    activeStyle = null;
                    text.Append('\r');
                    runStart = text.Length;
                }

                foreach (var cell in _lines[lineIndex])
                {
                    if (activeStyle != cell.Style)
                    {
                        FlushRun();
                        activeStyle = cell.Style;
                        runStart = text.Length;
                    }
                    text.Append(cell.Character);
                }
            }

            FlushRun();
            return new TerminalSnapshot(text.ToString(), runs);
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
                if (character == '\a') _state = ParserState.Normal;
                else if (character == '\x1b') _state = ParserState.OscEscape;
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
                ResetScreen(resetStyle: true);
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

        if (_sequence.Length < 256) _sequence.Append(character);
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
            case 'A': _row = Math.Max(0, _row - count); EnsureRow(_row); break;
            case 'B': _row += count; EnsureRow(_row); break;
            case 'C': _column += count; EnsureColumn(CurrentLine(), _column); break;
            case 'D': _column = Math.Max(0, _column - count); break;
            case 'E': _row += count; _column = 0; EnsureRow(_row); break;
            case 'F': _row = Math.Max(0, _row - count); _column = 0; EnsureRow(_row); break;
            case 'G': _column = Math.Max(0, count - 1); EnsureColumn(CurrentLine(), _column); break;
            case 'H':
            case 'f':
                _row = Math.Max(0, values.Count > 0 && values[0] > 0 ? values[0] - 1 : 0);
                _column = Math.Max(0, values.Count > 1 && values[1] > 0 ? values[1] - 1 : 0);
                EnsureRow(_row);
                EnsureColumn(CurrentLine(), _column);
                break;
            case 'd': _row = Math.Max(0, count - 1); EnsureRow(_row); break;
            case 'J': EraseDisplay(first); break;
            case 'K': EraseLine(first); break;
            case 'P': DeleteCharacters(count); break;
            case '@': InsertCharacters(count); break;
            case 'X': EraseCharacters(count); break;
            case 's': SaveCursor(); break;
            case 'u': RestoreCursor(); break;
            case 'm': ApplySgr(values); break;
            default:
                // Private modes, scroll regions and device-status queries do not change the text
                // snapshot Xplorer renders. ConPTY still receives the complete stream.
                break;
        }
    }

    private void ApplySgr(IReadOnlyList<int> values)
    {
        if (values.Count == 0)
        {
            _style = TerminalStyle.Default;
            return;
        }

        for (var index = 0; index < values.Count; index++)
        {
            var value = values[index];
            switch (value)
            {
                case 0: _style = TerminalStyle.Default; break;
                case 1: _style = _style with { Bold = true, Dim = false }; break;
                case 2: _style = _style with { Dim = true, Bold = false }; break;
                case 7: _style = _style with { Inverse = true }; break;
                case 22: _style = _style with { Bold = false, Dim = false }; break;
                case 27: _style = _style with { Inverse = false }; break;
                case >= 30 and <= 37:
                    _style = _style with { Foreground = TerminalColor.FromAnsi(value - 30, bright: false) };
                    break;
                case 39:
                    _style = _style with { Foreground = null };
                    break;
                case >= 40 and <= 47:
                    _style = _style with { Background = TerminalColor.FromAnsi(value - 40, bright: false) };
                    break;
                case 49:
                    _style = _style with { Background = null };
                    break;
                case >= 90 and <= 97:
                    _style = _style with { Foreground = TerminalColor.FromAnsi(value - 90, bright: true) };
                    break;
                case >= 100 and <= 107:
                    _style = _style with { Background = TerminalColor.FromAnsi(value - 100, bright: true) };
                    break;
                case 38:
                    if (TryReadExtendedColor(values, ref index, out var foreground))
                        _style = _style with { Foreground = foreground };
                    break;
                case 48:
                    if (TryReadExtendedColor(values, ref index, out var background))
                        _style = _style with { Background = background };
                    break;
            }
        }
    }

    private static bool TryReadExtendedColor(IReadOnlyList<int> values, ref int index, out TerminalColor color)
    {
        color = default;
        if (index + 1 >= values.Count) return false;

        var mode = values[index + 1];
        if (mode == 5 && index + 2 < values.Count)
        {
            color = TerminalColor.FromPalette(Math.Clamp(values[index + 2], 0, 255));
            index += 2;
            return true;
        }

        if (mode == 2 && index + 4 < values.Count)
        {
            color = new TerminalColor(
                (byte)Math.Clamp(values[index + 2], 0, 255),
                (byte)Math.Clamp(values[index + 3], 0, 255),
                (byte)Math.Clamp(values[index + 4], 0, 255));
            index += 4;
            return true;
        }

        return false;
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
        var cell = new TerminalCell(character, _style);
        if (_column < line.Count) line[_column] = cell;
        else line.Add(cell);
        _column++;
    }

    private void EraseDisplay(int mode)
    {
        switch (mode)
        {
            case 2:
            case 3:
                ResetScreen(resetStyle: false);
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
                EnsureColumn(line, _column + 1);
                for (var index = 0; index <= Math.Min(_column, line.Count - 1); index++)
                    line[index] = new TerminalCell(' ', _style);
                break;
            case 2:
                line.Clear();
                break;
            default:
                if (_column < line.Count) line.RemoveRange(_column, line.Count - _column);
                break;
        }
    }

    private void DeleteCharacters(int count)
    {
        var line = CurrentLine();
        if (_column >= line.Count) return;
        line.RemoveRange(_column, Math.Min(count, line.Count - _column));
    }

    private void InsertCharacters(int count)
    {
        var line = CurrentLine();
        EnsureColumn(line, _column);
        line.InsertRange(_column, Enumerable.Repeat(new TerminalCell(' ', _style), count));
    }

    private void EraseCharacters(int count)
    {
        var line = CurrentLine();
        EnsureColumn(line, _column + count);
        for (var index = _column; index < Math.Min(line.Count, _column + count); index++)
            line[index] = new TerminalCell(' ', _style);
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

    private void ResetScreen(bool resetStyle)
    {
        _lines.Clear();
        _lines.Add([]);
        _row = 0;
        _column = 0;
        if (resetStyle) _style = TerminalStyle.Default;
    }

    private List<TerminalCell> CurrentLine()
    {
        EnsureRow(_row);
        return _lines[_row];
    }

    private void EnsureRow(int row)
    {
        while (_lines.Count <= row) _lines.Add([]);
    }

    private void EnsureColumn(List<TerminalCell> line, int column)
    {
        while (line.Count < column) line.Add(new TerminalCell(' ', _style));
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

    private readonly record struct TerminalCell(char Character, TerminalStyle Style);

    private enum ParserState
    {
        Normal,
        Escape,
        Csi,
        Osc,
        OscEscape,
    }
}

internal readonly record struct TerminalSnapshot(string Text, IReadOnlyList<TerminalStyleRun> Runs);
internal readonly record struct TerminalStyleRun(int Start, int Length, TerminalStyle Style);
internal readonly record struct TerminalStyle(
    TerminalColor? Foreground,
    TerminalColor? Background,
    bool Bold,
    bool Dim,
    bool Inverse)
{
    public static TerminalStyle Default => new(null, null, false, false, false);
}

internal readonly record struct TerminalColor(byte R, byte G, byte B)
{
    private static readonly TerminalColor[] Ansi =
    [
        new(12, 12, 12), new(197, 15, 31), new(19, 161, 14), new(193, 156, 0),
        new(0, 55, 218), new(136, 23, 152), new(58, 150, 221), new(204, 204, 204),
        new(118, 118, 118), new(231, 72, 86), new(22, 198, 12), new(249, 241, 165),
        new(59, 120, 255), new(180, 0, 158), new(97, 214, 214), new(242, 242, 242),
    ];

    public static TerminalColor FromAnsi(int index, bool bright) =>
        Ansi[Math.Clamp(index + (bright ? 8 : 0), 0, 15)];

    public static TerminalColor FromPalette(int index)
    {
        index = Math.Clamp(index, 0, 255);
        if (index < 16) return Ansi[index];
        if (index >= 232)
        {
            var value = (byte)(8 + (index - 232) * 10);
            return new(value, value, value);
        }

        var cube = index - 16;
        var r = cube / 36;
        var g = (cube / 6) % 6;
        var b = cube % 6;
        static byte Level(int value) => (byte)(value == 0 ? 0 : 55 + value * 40);
        return new(Level(r), Level(g), Level(b));
    }
}
